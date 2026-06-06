import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import 'sidecar_audio_client.dart';
import 'vad.dart';

enum DictationStatus {
  idle,
  permissionPending,
  listening,
  recording,
  uploading,
  transcribing,
  error,
}

/// Desktop dictation — continuous mic capture + amplitude VAD pause-send.
class DictationController extends ChangeNotifier {
  DictationController({
    DictationEndpointOptions? endpointOptions,
    bool Function()? shouldBlockSpeechCapture,
  })  : endpointOptions = endpointOptions ?? const DictationEndpointOptions(),
        shouldBlockSpeechCapture = shouldBlockSpeechCapture;

  DictationEndpointOptions endpointOptions;
  bool Function()? shouldBlockSpeechCapture;

  final AudioRecorder _recorder = AudioRecorder();

  DictationStatus status = DictationStatus.idle;
  String? error;
  bool sessionActive = false;
  int? autoSendCountdownMs;
  String liveText = '';
  double sessionCostUsd = 0;

  StreamSubscription<Amplitude>? _ampSub;
  Timer? _maxRecordingTimer;
  AmplitudeVad? _vad;
  String? _recordPath;
  int _recordingStartedAt = 0;
  bool _utteranceActive = false;
  bool _endpointInFlight = false;
  bool _suspendedForTts = false;
  SidecarAudioClient? _audioClient;

  /// Fallback pause detection (peak-relative) when AGC skews the noise floor.
  double _utterancePeakDb = -90;
  int _lastLoudAtMs = 0;

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
    onSessionActiveChange?.call();
    await _startMicCapture();
  }

  Future<void> endSession() async {
    sessionActive = false;
    await _teardown();
    status = DictationStatus.idle;
    autoSendCountdownMs = null;
    liveText = '';
    onSessionActiveChange?.call();
    notifyListeners();
  }

  Future<void> cancel() async {
    sessionActive = false;
    await _teardown();
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

  static const _recordConfig = RecordConfig(
    encoder: AudioEncoder.wav,
    sampleRate: 16000,
    numChannels: 1,
    // AGC keeps levels high after speech and breaks pause detection.
    autoGain: false,
    echoCancel: true,
    noiseSuppress: true,
  );

  /// Release the mic while agent TTS plays (Windows WASAPI conflicts otherwise).
  Future<void> suspendForTts() async {
    if (_suspendedForTts || !sessionActive) return;
    _suspendedForTts = true;
    await _ampSub?.cancel();
    _ampSub = null;
    if (await _recorder.isRecording()) {
      await _recorder.stop();
    }
    _utteranceActive = false;
    _vad?.disarmUtterance();
    autoSendCountdownMs = null;
    if (status != DictationStatus.error) {
      status = DictationStatus.listening;
    }
    notifyListeners();
  }

  Future<void> resumeAfterTts() async {
    if (!_suspendedForTts || !sessionActive) return;
    _suspendedForTts = false;
    await _startMicCapture();
  }

  Future<void> _startMicCapture() async {
    if (!sessionActive || _suspendedForTts) return;

    _vad ??= AmplitudeVad(
      onSpeechStart: () => unawaited(_onSpeechStart()),
      onSilenceTick: _onSilenceTick,
      onSpeechResume: () {
        autoSendCountdownMs = null;
        notifyListeners();
      },
    );
    _vad!.resetSession();

    await _ampSub?.cancel();
    if (await _recorder.isRecording()) {
      await _recorder.stop();
    }

    _recordPath = await _tempPath('utterance-${DateTime.now().millisecondsSinceEpoch}.wav');
    await _recorder.start(_recordConfig, path: _recordPath!);

    _ampSub = _recorder.onAmplitudeChanged(const Duration(milliseconds: 50)).listen(
      (amp) {
        final db = AmplitudeVad.sanitizeDb(amp.current);
        _vad?.ingestAmplitudeDb(db);
        _trackPeakSilence(db);
      },
    );

    _utteranceActive = false;
    _endpointInFlight = false;
    _autoSentLatch = false;
    _utterancePeakDb = -90;
    status = DictationStatus.listening;
    liveText = '';
    autoSendCountdownMs = null;
    notifyListeners();
  }

  /// Peak-relative silence — immune to AGC / noise-floor drift between words.
  void _trackPeakSilence(double db) {
    if (shouldBlockSpeechCapture?.call() == true) return;
    if (!_utteranceActive || _endpointInFlight || _autoSentLatch) return;
    final now = DateTime.now().millisecondsSinceEpoch;

    // Absolute loudness or within 14 dB of utterance peak counts as voice.
    const peakMarginDb = 14;
    const absoluteLoudDb = -42;
    final relativeThreshold = _utterancePeakDb - peakMarginDb;
    final isVoice = db > absoluteLoudDb || db > relativeThreshold;

    if (isVoice) {
      if (db > _utterancePeakDb) _utterancePeakDb = db;
      _lastLoudAtMs = now;
      if (autoSendCountdownMs != null) {
        autoSendCountdownMs = null;
        notifyListeners();
      }
      return;
    }

    final recordingMs = now - _recordingStartedAt;
    if (recordingMs < endpointOptions.minRecordingMs) return;

    final msSinceVoice = now - _lastLoudAtMs;
    final threshold = recordingMs < 5000
        ? endpointOptions.silenceMsShort
        : endpointOptions.silenceMsLong;
    final remaining = threshold - msSinceVoice;
    if (remaining > 0) {
      if (autoSendCountdownMs != remaining) {
        autoSendCountdownMs = remaining;
        notifyListeners();
      }
    } else if (!_endpointInFlight) {
      unawaited(_endpointUtterance(silenceDeadline: true));
    }
  }

  Future<void> _onSpeechStart() async {
    if (shouldBlockSpeechCapture?.call() == true) return;
    if (!sessionActive || _utteranceActive || _endpointInFlight) return;
    onBargeIn?.call();
    _utteranceActive = true;
    _recordingStartedAt = DateTime.now().millisecondsSinceEpoch;
    _lastLoudAtMs = _recordingStartedAt;
    _utterancePeakDb = -90;
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

    final path = _recordPath;
    await _ampSub?.cancel();
    _ampSub = null;
    if (await _recorder.isRecording()) {
      await _recorder.stop();
    }

    notifyListeners();

    if (path == null || !File(path).existsSync()) {
      _finishEndpoint(clearError: true);
      if (sessionActive) await _startMicCapture();
      return;
    }

    final bytes = await File(path).readAsBytes();
    try {
      await File(path).delete();
    } catch (_) {}

    if (bytes.length < 1200 && !force) {
      _finishEndpoint(clearError: true);
      if (sessionActive) await _startMicCapture();
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
      final attachmentId = await client.uploadWavBytes(bytes);
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
        error = 'No speech detected — try again.';
        status = DictationStatus.error;
      }
    } catch (e) {
      onCaptureActiveChange?.call(false);
      status = DictationStatus.error;
      liveText = '';
      error = e is HttpException ? (e.message ?? e.toString()) : e.toString();
    }

    _finishEndpoint();
    if (sessionActive && status != DictationStatus.error) {
      status = DictationStatus.listening;
      liveText = '';
      await _startMicCapture();
    }
    notifyListeners();
  }

  void _finishEndpoint({bool clearError = false}) {
    _endpointInFlight = false;
    _autoSentLatch = false;
    if (clearError) error = null;
  }

  Future<void> _teardown() async {
    _maxRecordingTimer?.cancel();
    await _ampSub?.cancel();
    _ampSub = null;
    if (await _recorder.isRecording()) {
      await _recorder.stop();
    }
    _utteranceActive = false;
    _endpointInFlight = false;
    _vad?.disarmUtterance();
    onCaptureActiveChange?.call(false);
  }

  Future<String> _tempPath(String name) async {
    final dir = await getTemporaryDirectory();
    return '${dir.path}/liminal-$name';
  }

  @override
  void dispose() {
    unawaited(_teardown());
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
