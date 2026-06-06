import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/audio/vad.dart';

void main() {
  test('AmplitudeVad fires speech start after calibration', () {
    var started = false;
    final vad = AmplitudeVad(
      calibrationMs: 100,
      speechGainDb: 8,
      speechDebounceFrames: 1,
      onSpeechStart: () => started = true,
    );
    vad.resetSession();
    for (var i = 0; i < 10; i++) {
      vad.ingestAmplitudeDb(-65);
    }
    for (var i = 0; i < 5; i++) {
      vad.ingestAmplitudeDb(-35);
    }
    expect(started, isTrue);
  });

  test('armed utterance keeps silence ticks across word gaps', () {
    var maxSilence = 0;
    final vad = AmplitudeVad(
      calibrationMs: 50,
      onSilenceTick: (ms) {
        if (ms > maxSilence) maxSilence = ms;
      },
    );
    vad.resetSession();
    for (var i = 0; i < 8; i++) {
      vad.ingestAmplitudeDb(-65);
    }
    vad.armUtterance();
    // Brief word gap — must NOT disarm.
    for (var i = 0; i < 4; i++) {
      vad.ingestAmplitudeDb(-80);
    }
    // Resume speaking.
    for (var i = 0; i < 4; i++) {
      vad.ingestAmplitudeDb(-35);
    }
    // Final silence.
    for (var i = 0; i < 40; i++) {
      vad.ingestAmplitudeDb(-80);
    }
    expect(maxSilence, greaterThan(100));
  });
}
