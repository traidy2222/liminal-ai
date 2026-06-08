import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/foundation.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import 'sidecar_audio_client.dart';
import 'vad.dart';
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
    bool Function()? shouldBlockSpeechCapture,
  })  : endpointOptions = endpointOptions ?? const DictationEndpointOptions(),
        shouldBlockSpeechCapture = shouldBlockSpeechCapture;

  DictationEndpointOptions endpointOptions;
  bool Function()? shouldBlockSpeechCapture;
  bool Function()? isTtsPipelineActive;

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

  Future<void> _micChain = Future.value();

  static const _sampleRate = 16000;
  static const _preRollMs = 450;
  static int get _preRollMaxBytes => _sampleRate * 2 * _preRollMs ~/ 1000;

  void bindAudioClient(SidecarAudioClient? client) {
    _audioClient = client;
  }

  Future<bool> _ensureMicPermission() async {
    final ok = await _recorder.hasPermission();
    if (ok) return true;
    final status = await Permission.microphone.request();
    return status.isGranted;
  }

  Future<void> startSession() async {
    if (sessionActive) return;
    error = null;
    status = DictationStatus.permissionPending;
    notifyListeners();
    if (!await _ensureMicPermission()) {
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
    await _runMicOp(() => _teardownStream());
    status = DictationStatus.idle;
    autoSendCountdownMs = null;
    liveText = '';
    onSessionActiveChange?.call();
    notifyListeners();
  }

  Future<void> cancel() async {
    sessionActive = false;
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
    if (sessionActive && !_streamLive && !_suspendedForTts && !_endpointInFlight) {
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
    if (_utteranceActive) {
      _utterancePcm ??= BytesBuilder(copy: false);
      _utterancePcm!.add(chunk);
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
    if (!sessionActive || _utteranceActive || _endpointInFlight || !_streamLive) {
      return;
    }
    onBargeIn?.call();
    _utteranceActive = true;
    _utterancePcm = BytesBuilder(copy: false);
    for (final chunk in _preRollChunks) {
      _utterancePcm!.add(chunk);
    }
    _clearPreRoll();

    _recordingStartedAt = DateTime.now().millisecondsSinceEpoch;
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
    final recordingMs = DateTime.now().millisecondsSinceEpoch - _recordingStartedAt;
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
      return;
    }

    final wav = buildWavFromPcm16(pcm, sampleRate: _sampleRate);
    if (wav.length < 1200 && !force) {
      _finishEndpoint(clearError: true);
      return;
    }

    final client = _audioClient;
    if (client == null) {
      status = DictationStatus.error;
      error = 'Audio client not configured.';
      _finishEndpoint();
      notifyListeners();
      return;
    }

    status = DictationStatus.uploading;
    liveText = 'Transcribing…';
    onCaptureActiveChange?.call(true);
    onInterim?.call(liveText);
    notifyListeners();

    try {
      final attachmentId = await client.uploadWavBytes(wav);
      status = DictationStatus.transcribing;
      notifyListeners();
      final result = await client.transcribe(attachmentId);
      onCaptureActiveChange?.call(false);
      final text = result?.text.trim() ?? '';
      if (text.isNotEmpty) {
        liveText = text;
        onRefined?.call(text, wasAutoSent: true);
        await onAutoSend?.call(text);
        sessionCostUsd += result?.costUsd ?? 0;
      } else if (force || silenceDeadline) {
        liveText = '';
      }
    } catch (e) {
      onCaptureActiveChange?.call(false);
      liveText = '';
      error = e is HttpException ? e.message : e.toString();
      status = DictationStatus.error;
    }

    _finishEndpoint();
    if (sessionActive && status != DictationStatus.error) {
      status = _streamLive ? DictationStatus.listening : DictationStatus.paused;
      liveText = '';
      if (!_streamLive && !_suspendedForTts) {
        unawaited(reconcileListening());
      }
    }
    notifyListeners();
  }

  void _finishEndpoint({bool clearError = false}) {
    _endpointInFlight = false;
    _autoSentLatch = false;
    if (clearError) error = null;
  }

  @override
  void dispose() {
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
