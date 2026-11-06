import 'dart:math' as math;
import 'dart:typed_data';

/// Voice activity from microphone amplitude (dBFS).
///
/// Two phases:
/// - **Idle** (session listening): detect speech onset → [onSpeechStart]
/// - **Armed** (utterance in progress): track pause → [onSilenceTick] until
///   [disarmUtterance] — never auto-disarm on brief gaps between words.
class AmplitudeVad {
  AmplitudeVad({
    this.speechGainDb = 8,
    this.calibrationMs = 350,
    this.speechDebounceFrames = 2,
    this.onSpeechStart,
    this.onSilenceTick,
    this.onSpeechResume,
    int Function()? nowMs,
  }) : _nowMs = nowMs ?? (() => DateTime.now().millisecondsSinceEpoch);

  final int Function() _nowMs;

  final double speechGainDb;
  final int calibrationMs;
  final int speechDebounceFrames;
  final void Function()? onSpeechStart;
  final void Function(int msSinceSpeechEnded)? onSilenceTick;
  final void Function()? onSpeechResume;

  bool _utteranceArmed = false;
  int _speechFrames = 0;
  int? _silenceStartedAt;
  double _noiseFloorDb = -60;
  int _startedAt = 0;
  bool _calibrated = false;
  double get noiseFloorDb => _noiseFloorDb;

  /// Measure the audio actually captured, rather than relying on a platform
  /// amplitude meter that may stop updating while PCM streaming on Windows.
  static double pcmDb(Uint8List pcm) {
    final samples = pcm.length ~/ 2;
    if (samples == 0) return -90;
    final data = ByteData.sublistView(pcm);
    var squares = 0.0;
    for (var i = 0; i < samples; i++) {
      final sample = data.getInt16(i * 2, Endian.little) / 32768;
      squares += sample * sample;
    }
    if (squares == 0) return -90;
    return sanitizeDb(10 * math.log(squares / samples) / math.ln10);
  }

  void resetSession() {
    _startedAt = _nowMs();
    _calibrated = false;
    _noiseFloorDb = -60;
    _utteranceArmed = false;
    _speechFrames = 0;
    _silenceStartedAt = null;
  }

  void armUtterance() {
    _utteranceArmed = true;
    _speechFrames = 0;
    _silenceStartedAt = null;
  }

  void disarmUtterance() {
    _utteranceArmed = false;
    _speechFrames = 0;
    _silenceStartedAt = null;
  }

  static double sanitizeDb(double db) {
    if (db.isNaN || db.isInfinite) return -90;
    if (db < -90) return -90;
    if (db > 0) return 0;
    return db;
  }

  void ingestAmplitudeDb(double rawDb) {
    final db = sanitizeDb(rawDb);
    final now = _nowMs();
    if (_startedAt == 0) _startedAt = now;

    if (!_calibrated) {
      final elapsed = now - _startedAt;
      _noiseFloorDb = (_noiseFloorDb * 0.8) + (db * 0.2);
      if (elapsed >= calibrationMs) {
        _calibrated = true;
      } else {
        return;
      }
    }

    final threshold = _noiseFloorDb + speechGainDb;
    final isLoud = db > threshold;

    if (_utteranceArmed) {
      if (isLoud) {
        if (_silenceStartedAt != null) {
          _silenceStartedAt = null;
          onSpeechResume?.call();
        }
        return;
      }
      _silenceStartedAt ??= now;
      final msSince = now - (_silenceStartedAt ?? now);
      onSilenceTick?.call(msSince);
      return;
    }

    // Idle — waiting for speech onset.
    if (isLoud) {
      _speechFrames++;
      if (_speechFrames >= speechDebounceFrames) {
        _speechFrames = 0;
        onSpeechStart?.call();
      }
    } else {
      _speechFrames = 0;
      // Slowly track ambient level while idle.
      _noiseFloorDb = (_noiseFloorDb * 0.95) + (db * 0.05);
    }
  }
}
