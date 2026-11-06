import 'dart:async';
import 'package:flutter/foundation.dart';
import 'dictation_controller.dart';
import 'sidecar_audio_client.dart';
import 'wake_voice.dart';
import 'voice_timing.dart';

class WakeSendResult {
  const WakeSendResult({this.accepted = false, this.busy = false, this.error});
  final bool accepted;
  final bool busy;
  final String? error;
}

/// Separate from composer dictation: idle speech never enters a draft or chat.
class WakeVoiceController extends ChangeNotifier {
  WakeVoiceController({
    required this.send,
    required this.onWake,
    required this.onAwakeChanged,
    required this.isBusy,
    required this.isPlaying,
    DictationController? recorder,
    int Function()? now,
  }) : dictation =
           recorder ??
           DictationController(
             wakeListening: true,
             endpointOptions: const DictationEndpointOptions(
               minRecordingMs: 400,
               silenceMsShort: 450,
               silenceMsLong: 750,
             ),
           ),
       _now = now ?? (() => DateTime.now().millisecondsSinceEpoch) {
    dictation.onAutoSend = acceptTranscript;
    dictation.addListener(_onCaptureChanged);
  }

  final DictationController dictation;
  final Future<WakeSendResult> Function(String chatId, String text) send;
  final Future<void> Function(String chatId) onWake;
  final Future<void> Function(String chatId, bool awake) onAwakeChanged;
  final bool Function(String chatId) isBusy;
  final bool Function() isPlaying;
  final int Function() _now;
  final gate = WakeVoiceGate(const WakeVoiceSettings());
  final List<String> _pending = [];
  String? chatId;
  String? error;
  bool paused = false;
  bool _sending = false;
  bool _disposed = false;
  bool _retryBlocked = false;
  int _busyRetries = 0;
  int _nextRetry = 0;
  int _generation = 0;
  Timer? _timer;
  SidecarAudioClient? _boundClient;
  DictationStatus? _lastCaptureStatus;
  String? _lastCaptureError;
  bool? _lastCaptureSession;
  bool get awake => gate.awake;
  bool get enabled => gate.settings.enabled;
  bool get listening => dictation.sessionActive;
  int get pendingCount => _pending.length;

  void _changed() {
    if (!_disposed) notifyListeners();
  }

  void _onCaptureChanged() {
    // No app-wide rebuilds for background countdown ticks or provisional text.
    if (_lastCaptureStatus == dictation.status &&
        _lastCaptureError == dictation.error &&
        _lastCaptureSession == dictation.sessionActive) {
      return;
    }
    _lastCaptureStatus = dictation.status;
    _lastCaptureError = dictation.error;
    _lastCaptureSession = dictation.sessionActive;
    _changed();
  }

  Future<void> configure(WakeVoiceSettings settings) async {
    final changedPhrase = settings.phrase != gate.settings.phrase;
    final changedEnabled = settings.enabled != enabled;
    gate.settings = settings;
    if (changedEnabled) paused = false;
    if (!settings.enabled) {
      await stop();
    } else if (changedPhrase) {
      await sleep();
    }
    _changed();
  }

  Future<void> start(SidecarAudioClient client) async {
    if (_disposed || !enabled || paused) return;
    if (chatId != client.chatId ||
        _boundClient?.port != client.port ||
        _boundClient?.token != client.token) {
      await stop();
    }
    if (_disposed || !enabled || paused) return;
    chatId = client.chatId;
    _boundClient = client;
    dictation.bindAudioClient(client);
    final generation = _generation;
    await dictation.startSession();
    if (_disposed ||
        generation != _generation ||
        !enabled ||
        paused ||
        !dictation.sessionActive) {
      return;
    }
    _timer ??= Timer.periodic(const Duration(seconds: 1), (_) => tick());
    _changed();
  }

  Future<void> stop() async {
    _generation++;
    _timer?.cancel();
    _timer = null;
    // Closing the physical microphone must not wait for a network acknowledgement.
    unawaited(
      sleep().catchError((Object e) {
        reportError(e.toString());
      }),
    );
    await dictation.endSession();
    _changed();
  }

  Future<void> pause() async {
    paused = true;
    await stop();
  }

  void resume() {
    paused = false;
    error = null;
    _retryBlocked = false;
    _changed();
  }

  Future<void> sleep() async {
    _generation++;
    final wasAwake = awake;
    gate.sleep();
    _pending.clear();
    _retryBlocked = false;
    _busyRetries = 0;
    _nextRetry = 0;
    error = null;
    if (wasAwake && chatId != null) await onAwakeChanged(chatId!, false);
    _changed();
  }

  Future<void> acceptTranscript(String text) async {
    if (_disposed || !enabled || paused || !listening || chatId == null) return;
    final generation = _generation;
    final decision = gate.accept(text, _now());
    voiceTiming('wake_match', {
      'woke': decision.woke,
      'awake': awake,
      'hasCommand': decision.command != null,
    });
    if (decision.slept) {
      _generation++;
      _pending.clear();
      _retryBlocked = false;
      _busyRetries = 0;
      _nextRetry = 0;
      _changed();
      try {
        await onAwakeChanged(chatId!, false);
      } catch (e) {
        reportError(e.toString());
      }
      return;
    }
    if (decision.woke) {
      voiceTiming('wake_detected');
      if (!_retryBlocked) error = null;
      try {
        await onAwakeChanged(chatId!, true);
        await onWake(chatId!);
      } catch (e) {
        if (!_disposed && generation == _generation) {
          gate.sleep();
          error = 'Could not activate Mission Control: $e';
          unawaited(onAwakeChanged(chatId!, false).catchError((Object _) {}));
          _changed();
        }
        return;
      }
    }
    if (_disposed || generation != _generation || !awake) return;
    if (decision.command != null) {
      _pending.add(decision.command!);
      await drain();
    }
    _changed();
  }

  void tick() {
    if (_disposed || !enabled || paused || chatId == null) return;
    if (awake &&
        (isBusy(chatId!) ||
            isPlaying() ||
            dictation.status == DictationStatus.recording ||
            dictation.status == DictationStatus.transcribing ||
            dictation.status == DictationStatus.uploading ||
            _sending)) {
      gate.touch(_now());
    } else if (gate.expire(_now())) {
      unawaited(
        onAwakeChanged(chatId!, false).catchError((Object e) {
          reportError('Could not end the voice session: $e');
        }),
      );
      _changed();
    }
    unawaited(drain());
  }

  Future<void> drain() async {
    if (_disposed ||
        _sending ||
        _retryBlocked ||
        !awake ||
        chatId == null ||
        _pending.isEmpty ||
        isBusy(chatId!) ||
        _now() < _nextRetry) {
      return;
    }
    _sending = true;
    final generation = _generation;
    final message = _pending.first;
    try {
      final result = await send(chatId!, message);
      if (_disposed || generation != _generation) return;
      if (result.accepted) {
        if (_pending.isNotEmpty && _pending.first == message) {
          _pending.removeAt(0);
        }
        error = null;
        _busyRetries = 0;
        _nextRetry = 0;
      } else if (result.busy) {
        _busyRetries++;
        _nextRetry = _now() + (_busyRetries * 1000).clamp(1000, 5000);
        if (_busyRetries >= 6) {
          _retryBlocked = true;
          error =
              'Mission Control is still busy. Your unsent request is retained.';
        }
      } else if (!result.busy) {
        // An uncertain network acknowledgement must never automatically replay a task.
        _retryBlocked = true;
        error = result.error ?? 'Send not confirmed. Your request is retained.';
      }
    } catch (e) {
      if (!_disposed && generation == _generation) {
        _retryBlocked = true;
        error = e.toString();
      }
    } finally {
      _sending = false;
      _changed();
    }
  }

  void reportError(String message) {
    error = message;
    _changed();
  }

  void retryPending() {
    _retryBlocked = false;
    _busyRetries = 0;
    _nextRetry = 0;
    error = null;
    unawaited(drain());
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    _timer?.cancel();
    dictation.removeListener(_onCaptureChanged);
    dictation.dispose();
    super.dispose();
  }
}
