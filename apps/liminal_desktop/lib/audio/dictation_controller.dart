import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import 'sidecar_audio_client.dart';
import 'vad.dart';
import 'voice_timing.dart';
import 'wav_pcm.dart';

enum DictationStatus {
  idle,
  permissionPending,
  listening,

  /// Mic session on but stream released while agent TTS plays.
  paused,
  recording,
  uploading,
  transcribing,
  error,
}

/// Desktop dictation — session-long PCM stream + amplitude VAD (mirrors web).
///
/// The mic stream stays open between utterances; only TTS playback stops it
/// (Windows WASAPI). Utterance audio is buffered in memory, not via stop/start
/// per send.
class DictationController extends ChangeNotifier {
  DictationController({
    DictationEndpointOptions? endpointOptions,
    this.shouldBlockSpeechCapture,
    this.wakeListening = false,
  }) : endpointOptions = endpointOptions ?? const DictationEndpointOptions();

  DictationEndpointOptions endpointOptions;
  bool Function()? shouldBlockSpeechCapture;
  final bool wakeListening;
  bool Function()? isTtsPipelineActive;
  Future<void> Function()? beforeStartSession;

  AudioRecorder _recorder = AudioRecorder();

  DictationStatus status = DictationStatus.idle;
  String? error;
  bool sessionActive = false;
  int? autoSendCountdownMs;
  String liveText = '';
  double sessionCostUsd = 0;

  StreamSubscription<Uint8List>? _pcmSub;
  Timer? _ampPollTimer;
  Timer? _maxRecordingTimer;
  Timer? _micWatchdog;
  AmplitudeVad? _vad;
  int _recordingStartedAt = 0;
  int _lastPcmLevelAt = 0;
  int _lastLevelDiagnosticAt = 0;
  int? _lastVadSpeechEndMs;
  bool _utteranceActive = false;
  bool _endpointInFlight = false;
  bool _suspendedForTts = false;
  bool _streamLive = false;
  bool _vadNeedsSessionReset = true;
  SidecarAudioClient? _audioClient;

  /// Rolling pre-roll so utterance capture includes speech onset.
  final List<Uint8List> _preRollChunks = [];
  int _preRollBytes = 0;
  BytesBuilder? _utterancePcm;
  final List<Uint8List> _previewChunks = [];
  int _previewBytes = 0;
  int _previewGeneration = 0;
  int _lastPreviewAt = 0;
  bool _previewBusy = false;
  int _sessionGeneration = 0;
  bool _disposed = false;

  void _resetPreview() {
    _previewGeneration++;
    _previewChunks.clear();
    _previewBytes = 0;
    _lastPreviewAt = 0;
  }

  void _pushPreview(Uint8List chunk) {
    if (wakeListening) return;
    _previewChunks.add(chunk);
    _previewBytes += chunk.length;
    const maximum = 12 * 16000 * 2;
    while (_previewBytes > maximum) {
      final first = _previewChunks.first;
      final drop = (_previewBytes - maximum).clamp(0, first.length);
      if (drop == first.length) {
        _previewChunks.removeAt(0);
      } else {
        _previewChunks[0] = Uint8List.sublistView(first, drop);
      }
      _previewBytes -= drop;
    }
    final now = DateTime.now().millisecondsSinceEpoch;
    final client = _audioClient;
    if (client == null ||
        _previewBusy ||
        _previewBytes < 25600 ||
        now - _lastPreviewAt < 800) {
      return;
    }
    final pcm = BytesBuilder(copy: false);
    for (final part in _previewChunks) {
      pcm.add(part);
    }
    final generation = _previewGeneration;
    _previewBusy = true;
    _lastPreviewAt = now;
    unawaited(
      client
          .preview(buildWavFromPcm16(pcm.toBytes()))
          .then((text) {
            if (!_disposed &&
                sessionActive &&
                _utteranceActive &&
                generation == _previewGeneration) {
              liveText = text;
              onInterim?.call(text);
              notifyListeners();
            }
          })
          .catchError((Object _) {
            /* Final transcription surfaces errors once. */
          })
          .whenComplete(() {
            _previewBusy = false;
          }),
    );
  }

  Future<void> _micChain = Future.value();

  static const _sampleRate = 16000;
  static const _preRollMs = 450;
  int get _preRollMaxBytes =>
      _sampleRate * 2 * (wakeListening ? 900 : _preRollMs) ~/ 1000;

  void bindAudioClient(SidecarAudioClient? client) {
    final previous = _audioClient;
    if (previous != null &&
        (client == null ||
            previous.chatId != client.chatId ||
            previous.port != client.port ||
            previous.token != client.token)) {
      previous.cancelTranscriptionRequests();
      if (sessionActive || status == DictationStatus.permissionPending) {
        unawaited(endSession());
      }
    }
    _audioClient = client;
  }

  Future<bool> _ensureMicPermission() async {
    final ok = await _recorder.hasPermission();
    if (ok) return true;
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> startSession() async {
    if (_disposed ||
        sessionActive ||
        status == DictationStatus.permissionPending) {
      return;
    }
    final generation = ++_sessionGeneration;
    status = DictationStatus.permissionPending;
    notifyListeners();
    try {
      await beforeStartSession?.call();
    } catch (e) {
      if (!_disposed && generation == _sessionGeneration) {
        status = DictationStatus.error;
        error = e.toString();
        notifyListeners();
      }
      return;
    }
    if (_disposed || sessionActive || generation != _sessionGeneration) return;
    error = null;
    status = DictationStatus.permissionPending;
    notifyListeners();
    bool granted;
    try {
      granted = await _ensureMicPermission();
    } catch (e) {
      if (!_disposed && generation == _sessionGeneration) {
        status = DictationStatus.error;
        error = e.toString();
        notifyListeners();
      }
      return;
    }
    if (_disposed || generation != _sessionGeneration) return;
    if (!granted) {
      status = DictationStatus.error;
      error = 'Microphone permission denied.';
      notifyListeners();
      return;
    }
    sessionActive = true;
    _autoSentLatch = false;
    _vadNeedsSessionReset = true;
    _clearPreRoll();
    _utterancePcm = null;
    _startMicWatchdog();
    onSessionActiveChange?.call();
    await _runMicOp(() => _openSessionStream());
  }

  Future<void> endSession() async {
    sessionActive = false;
    _sessionGeneration++;
    _audioClient?.cancelTranscriptionRequests();
    _resetPreview();
    await _runMicOp(() => _teardownStream());
    status = DictationStatus.idle;
    autoSendCountdownMs = null;
    liveText = '';
    onSessionActiveChange?.call();
    notifyListeners();
  }

  Future<void> cancel() async {
    sessionActive = false;
    _sessionGeneration++;
    _audioClient?.cancelTranscriptionRequests();
    _resetPreview();
    await _runMicOp(() => _teardownStream());
    status = DictationStatus.idle;
    autoSendCountdownMs = null;
    liveText = '';
    onSessionActiveChange?.call();
    notifyListeners();
  }

  Future<void> forceSend() async {
    if (!sessionActive || !_utteranceActive || _endpointInFlight) return;
    await _endpointUtterance(force: true);
  }

  void cancelPendingCountdown() {
    autoSendCountdownMs = null;
    notifyListeners();
  }

  bool _autoSentLatch = false;

  Future<void> Function(String fullMessage)? onAutoSend;
  void Function(String text)? onInterim;
  void Function(String refined, {required bool wasAutoSent})? onRefined;
  void Function()? onSessionActiveChange;
  void Function(bool captureActive)? onCaptureActiveChange;
  void Function()? onBargeIn;

  static const _streamConfig = RecordConfig(
    encoder: AudioEncoder.pcm16bits,
    sampleRate: _sampleRate,
    numChannels: 1,
    autoGain: false,
    echoCancel: true,
    noiseSuppress: true,
  );

  Future<void> _runMicOp(Future<void> Function() op) {
    _micChain = _micChain.then((_) => op()).catchError((_) {});
    return _micChain;
  }

  /// Release the mic while agent TTS plays (Windows WASAPI conflicts otherwise).
  Future<void> suspendForTts() async {
    if (!sessionActive || _suspendedForTts) return;
    await _runMicOp(() async {
      _suspendedForTts = true;
      await _closeSessionStream();
      if (!_endpointInFlight) {
        _utteranceActive = false;
        _utterancePcm = null;
        _vad?.disarmUtterance();
      }
      autoSendCountdownMs = null;
      if (status != DictationStatus.error) {
        status = DictationStatus.paused;
      }
      notifyListeners();
    });
  }

  Future<void> resumeAfterTts() async {
    if (!sessionActive) return;
    await _runMicOp(() async {
      _suspendedForTts = false;
      await _openSessionStream();
      notifyListeners();
    });
  }

  /// Heal stale pause / dead stream after agent turn or TTS tail.
  Future<void> reconcileListening() async {
    if (!sessionActive || _endpointInFlight) return;
    if (status == DictationStatus.uploading ||
        status == DictationStatus.transcribing ||
        status == DictationStatus.recording) {
      return;
    }
    if (isTtsPipelineActive?.call() == true) return;
    if (shouldBlockSpeechCapture?.call() == true) return;

    await _runMicOp(() async {
      if (_suspendedForTts) {
        _suspendedForTts = false;
      }
      if (!_streamLive) {
        await _openSessionStream();
      }
      notifyListeners();
    });
  }

  void _startMicWatchdog() {
    _micWatchdog?.cancel();
    _micWatchdog = Timer.periodic(const Duration(seconds: 2), (_) {
      if (!sessionActive || _endpointInFlight) return;
      if (_streamLive) return;
      if (isTtsPipelineActive?.call() == true) return;
      if (shouldBlockSpeechCapture?.call() == true) return;
      if (status == DictationStatus.uploading ||
          status == DictationStatus.transcribing ||
          status == DictationStatus.recording) {
        return;
      }
      unawaited(reconcileListening());
    });
  }

  Future<void> ensureListening({bool recreateRecorder = false}) async {
    await reconcileListening();
  }

  Future<void> _openSessionStream() async {
    if (!sessionActive || _suspendedForTts || _endpointInFlight) return;
    if (_streamLive) return;

    _vad ??= AmplitudeVad(
      calibrationMs: 600,
      onSpeechStart: () => unawaited(_onSpeechStart()),
      onSilenceTick: _onSilenceTick,
      onSpeechResume: () {
        autoSendCountdownMs = null;
        notifyListeners();
      },
    );
    if (_vadNeedsSessionReset) {
      _vad!.resetSession();
      _vadNeedsSessionReset = false;
    } else {
      _vad!.disarmUtterance();
    }

    try {
      final stream = await _recorder.startStream(_streamConfig);
      if (!sessionActive || _suspendedForTts) {
        await _recorder.cancel();
        return;
      }

      _streamLive = true;
      _lastPcmLevelAt = 0;
      voiceTiming('mic_open', {'wake': wakeListening});
      _pcmSub = stream.listen(
        _onPcmChunk,
        onError: (_) => unawaited(_handleStreamLost()),
        onDone: () => unawaited(_handleStreamLost()),
      );
      _startAmplitudePolling();

      _utteranceActive = false;
      _utterancePcm = null;
      _clearPreRoll();
      error = null;
      status = DictationStatus.listening;
      liveText = '';
      autoSendCountdownMs = null;
      notifyListeners();
    } catch (e) {
      _streamLive = false;
      _stopAmplitudePolling();
      if (!_endpointInFlight) {
        status = DictationStatus.error;
        error = 'Microphone stream failed: $e';
      }
      notifyListeners();
    }
  }

  /// `onAmplitudeChanged()` is single-subscription per [AudioRecorder] — polling
  /// survives TTS suspend/resume without "Stream has already been listened to".
  void _startAmplitudePolling() {
    _stopAmplitudePolling();
    _ampPollTimer = Timer.periodic(
      const Duration(milliseconds: 50),
      (_) => unawaited(_pollAmplitude()),
    );
  }

  void _stopAmplitudePolling() {
    _ampPollTimer?.cancel();
    _ampPollTimer = null;
  }

  Future<void> _pollAmplitude() async {
    if (DateTime.now().millisecondsSinceEpoch - _lastPcmLevelAt < 400) return;
    if (!_streamLive || _suspendedForTts || !sessionActive) return;
    try {
      if (!await _recorder.isRecording()) return;
      final amp = await _recorder.getAmplitude();
      final db = AmplitudeVad.sanitizeDb(amp.current);
      _vad?.ingestAmplitudeDb(db);
    } catch (_) {}
  }

  Future<void> _closeSessionStream() async {
    _stopAmplitudePolling();
    await _pcmSub?.cancel();
    _pcmSub = null;
    try {
      if (await _recorder.isRecording()) {
        await _recorder.cancel();
      }
      await _recorder.dispose();
    } catch (_) {}
    _recorder = AudioRecorder();
    _streamLive = false;
  }

  Future<void> _teardownStream() async {
    _micWatchdog?.cancel();
    _micWatchdog = null;
    _maxRecordingTimer?.cancel();
    await _closeSessionStream();
    _utteranceActive = false;
    _endpointInFlight = false;
    _suspendedForTts = false;
    _utterancePcm = null;
    _clearPreRoll();
    _vad?.disarmUtterance();
    onCaptureActiveChange?.call(false);
  }

  Future<void> _handleStreamLost() async {
    if (!sessionActive || _suspendedForTts || _endpointInFlight) {
      _streamLive = false;
      return;
    }
    _streamLive = false;
    if (status != DictationStatus.error &&
        status != DictationStatus.uploading &&
        status != DictationStatus.transcribing) {
      status = DictationStatus.listening;
    }
    notifyListeners();
    await Future<void>.delayed(const Duration(milliseconds: 300));
    if (sessionActive &&
        !_streamLive &&
        !_suspendedForTts &&
        !_endpointInFlight) {
      await _runMicOp(() => _openSessionStream());
    }
  }

  void _clearPreRoll() {
    _preRollChunks.clear();
    _preRollBytes = 0;
  }

  void _pushPreRoll(Uint8List chunk) {
    _preRollChunks.add(chunk);
    _preRollBytes += chunk.length;
    while (_preRollBytes > _preRollMaxBytes && _preRollChunks.isNotEmpty) {
      _preRollBytes -= _preRollChunks.removeAt(0).length;
    }
  }

  void _onPcmChunk(Uint8List chunk) {
    if (chunk.isEmpty) return;
    final now = DateTime.now().millisecondsSinceEpoch;
    _lastPcmLevelAt = now;
    final db = AmplitudeVad.pcmDb(chunk);
    if (!_suspendedForTts &&
        !_endpointInFlight &&
        shouldBlockSpeechCapture?.call() != true) {
      _vad?.ingestAmplitudeDb(db);
    }
    if (voiceTimingEnabled && now - _lastLevelDiagnosticAt >= 1000) {
      _lastLevelDiagnosticAt = now;
      voiceTiming('mic_level', {
        'db': db,
        'noiseFloorDb': _vad?.noiseFloorDb,
        'wake': wakeListening,
        'status': status.name,
      });
    }
    if (_utteranceActive) {
      _utterancePcm ??= BytesBuilder(copy: false);
      _utterancePcm!.add(chunk);
      _pushPreview(chunk);
      return;
    }
    if (!_endpointInFlight && !_suspendedForTts) {
      _pushPreRoll(chunk);
    }
  }

  int get _minPcmBytes =>
      _sampleRate * 2 * endpointOptions.minRecordingMs ~/ 1000;

  Future<void> _onSpeechStart() async {
    if (shouldBlockSpeechCapture?.call() == true) return;
    if (!sessionActive ||
        _utteranceActive ||
        _endpointInFlight ||
        !_streamLive) {
      return;
    }
    if (!wakeListening) onBargeIn?.call();
    error = null;
    _utteranceActive = true;
    onCaptureActiveChange?.call(true);
    _resetPreview();
    _utterancePcm = BytesBuilder(copy: false);
    for (final chunk in _preRollChunks) {
      _utterancePcm!.add(chunk);
    }
    _clearPreRoll();

    _recordingStartedAt = DateTime.now().millisecondsSinceEpoch;
    _lastVadSpeechEndMs = null;
    voiceTiming('speech_start');
    _vad?.armUtterance();
    _maxRecordingTimer?.cancel();
    _maxRecordingTimer = Timer(
      Duration(milliseconds: endpointOptions.maxRecordingMs),
      () => unawaited(_endpointUtterance(force: true)),
    );
    status = DictationStatus.recording;
    liveText = 'Recording…';
    onInterim?.call(liveText);
    notifyListeners();
  }

  void _onSilenceTick(int msSinceSpeechEnded) {
    if (!_utteranceActive || _endpointInFlight || _autoSentLatch) return;
    _lastVadSpeechEndMs =
        DateTime.now().millisecondsSinceEpoch - msSinceSpeechEnded;
    final recordingMs =
        DateTime.now().millisecondsSinceEpoch - _recordingStartedAt;
    if (recordingMs < endpointOptions.minRecordingMs) return;

    final threshold = recordingMs < 5000
        ? endpointOptions.silenceMsShort
        : endpointOptions.silenceMsLong;
    final remaining = threshold - msSinceSpeechEnded;
    if (remaining > 0) {
      if (autoSendCountdownMs != remaining) {
        autoSendCountdownMs = remaining;
        notifyListeners();
      }
    } else if (!_endpointInFlight) {
      unawaited(_endpointUtterance(silenceDeadline: true));
    }
  }

  Future<void> _endpointUtterance({
    bool force = false,
    bool silenceDeadline = false,
  }) async {
    if (_endpointInFlight) return;
    if (!_utteranceActive && !force) return;

    final recordingMs = _utteranceActive
        ? DateTime.now().millisecondsSinceEpoch - _recordingStartedAt
        : 0;
    if (!force && recordingMs < endpointOptions.minRecordingMs) return;

    final sessionGeneration = _sessionGeneration;
    voiceTiming('endpoint', {'speechEndMs': _lastVadSpeechEndMs});
    _resetPreview();
    _endpointInFlight = true;
    _autoSentLatch = true;
    autoSendCountdownMs = null;
    _maxRecordingTimer?.cancel();
    _utteranceActive = false;
    _vad?.disarmUtterance();

    final pcm = _utterancePcm?.toBytes() ?? Uint8List(0);
    _utterancePcm = null;

    if (status != DictationStatus.error) {
      status = DictationStatus.listening;
    }
    notifyListeners();

    if (pcm.length < _minPcmBytes && !force) {
      _finishEndpoint(clearError: true);
      onCaptureActiveChange?.call(false);
      return;
    }

    final wav = buildWavFromPcm16(pcm, sampleRate: _sampleRate);
    if (wav.length < 1200 && !force) {
      _finishEndpoint(clearError: true);
      onCaptureActiveChange?.call(false);
      return;
    }

    final client = _audioClient;
    if (client == null) {
      status = DictationStatus.error;
      error = 'Audio client not configured.';
      _finishEndpoint();
      onCaptureActiveChange?.call(false);
      notifyListeners();
      return;
    }

    status = DictationStatus.uploading;
    liveText = 'Transcribing…';
    onCaptureActiveChange?.call(true);
    onInterim?.call(liveText);
    notifyListeners();

    try {
      final attachmentId = wakeListening
          ? null
          : await client.uploadWavBytes(wav);
      if (_disposed ||
          !sessionActive ||
          sessionGeneration != _sessionGeneration) {
        return;
      }
      status = DictationStatus.transcribing;
      notifyListeners();
      voiceTiming('asr_start');
      final result = wakeListening
          ? await client.transcribeWake(wav)
          : await client.transcribe(attachmentId!);
      voiceTiming('asr_end');
      if (_disposed ||
          !sessionActive ||
          sessionGeneration != _sessionGeneration) {
        return;
      }
      onCaptureActiveChange?.call(false);
      final text = result?.text.trim() ?? '';
      voiceTiming('asr_result', {
        'wake': wakeListening,
        'characters': text.length,
        'hasText': text.isNotEmpty,
      });
      if (text.isNotEmpty) {
        liveText = text;
        onRefined?.call(text, wasAutoSent: true);
        await onAutoSend?.call(text);
        sessionCostUsd += result?.costUsd ?? 0;
      } else if (force || silenceDeadline) {
        liveText = '';
      }
    } catch (e) {
      if (_disposed ||
          !sessionActive ||
          sessionGeneration != _sessionGeneration) {
        return;
      }
      liveText = '';
      final message = e is HttpException ? e.message : e.toString();
      error = message;
    } finally {
      // An old upload/decode must never reset a newly started session.
      if (!_disposed && sessionGeneration == _sessionGeneration) {
        onCaptureActiveChange?.call(false);
        _finishEndpoint();
        if (sessionActive) {
          status = _streamLive
              ? DictationStatus.listening
              : DictationStatus.paused;
          liveText = '';
          if (!_streamLive && !_suspendedForTts) {
            unawaited(reconcileListening());
          }
        }
        notifyListeners();
      }
    }
  }

  void _finishEndpoint({bool clearError = false}) {
    _endpointInFlight = false;
    _autoSentLatch = false;
    if (clearError) error = null;
  }

  @override
  void dispose() {
    // Async recorder teardown must not call back into a disposed app controller.
    onCaptureActiveChange = null;
    onSessionActiveChange = null;
    onAutoSend = null;
    _disposed = true;
    _sessionGeneration++;
    _audioClient?.cancelTranscriptionRequests();
    _resetPreview();
    unawaited(_teardownStream());
    unawaited(_recorder.dispose());
    super.dispose();
  }
}

class DictationEndpointOptions {
  const DictationEndpointOptions({
    this.minRecordingMs = 1500,
    this.silenceMsShort = 1500,
    this.silenceMsLong = 2500,
    this.maxRecordingMs = 60000,
    this.audioCue = false,
  });

  final int minRecordingMs;
  final int silenceMsShort;
  final int silenceMsLong;
  final int maxRecordingMs;
  final bool audioCue;

  static DictationEndpointOptions fromAppConfig({
    required int minRecordingMs,
    required int silenceMsShort,
    required int silenceMsLong,
    required int maxRecordingMs,
    required bool audioCue,
  }) {
    return DictationEndpointOptions(
      minRecordingMs: minRecordingMs,
      silenceMsShort: silenceMsShort,
      silenceMsLong: silenceMsLong,
      maxRecordingMs: maxRecordingMs,
      audioCue: audioCue,
    );
  }
}
