import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/audio/vad.dart';
import 'dart:typed_data';

void main() {
  test(
    'PCM level follows captured samples even if the platform meter is stale',
    () {
      expect(AmplitudeVad.pcmDb(Uint8List(640)), -90);
      final pcm = Uint8List(640);
      final data = ByteData.sublistView(pcm);
      for (var i = 0; i < 320; i++) {
        data.setInt16(i * 2, i.isEven ? 16384 : -16384, Endian.little);
      }
      expect(AmplitudeVad.pcmDb(pcm), closeTo(-6.02, .02));
      expect(AmplitudeVad.pcmDb(Uint8List(1)), -90);
    },
  );
  test('AmplitudeVad fires speech start after calibration', () {
    var started = false;
    var now = 1000;
    final vad = AmplitudeVad(
      nowMs: () => now,
      calibrationMs: 100,
      speechGainDb: 8,
      speechDebounceFrames: 1,
      onSpeechStart: () => started = true,
    );
    vad.resetSession();
    for (var i = 0; i < 10; i++) {
      now += 25;
      vad.ingestAmplitudeDb(-65);
    }
    for (var i = 0; i < 5; i++) {
      now += 25;
      vad.ingestAmplitudeDb(-35);
    }
    expect(started, isTrue);
  });

  test('armed utterance keeps silence ticks across word gaps', () {
    var maxSilence = 0;
    var now = 1000;
    final vad = AmplitudeVad(
      nowMs: () => now,
      calibrationMs: 50,
      onSilenceTick: (ms) {
        if (ms > maxSilence) maxSilence = ms;
      },
    );
    vad.resetSession();
    for (var i = 0; i < 8; i++) {
      now += 25;
      vad.ingestAmplitudeDb(-65);
    }
    vad.armUtterance();
    // Brief word gap — must NOT disarm.
    for (var i = 0; i < 4; i++) {
      now += 25;
      vad.ingestAmplitudeDb(-80);
    }
    // Resume speaking.
    for (var i = 0; i < 4; i++) {
      now += 25;
      vad.ingestAmplitudeDb(-35);
    }
    // Final silence.
    for (var i = 0; i < 40; i++) {
      now += 25;
      vad.ingestAmplitudeDb(-80);
    }
    expect(maxSilence, greaterThan(100));
  });
}
