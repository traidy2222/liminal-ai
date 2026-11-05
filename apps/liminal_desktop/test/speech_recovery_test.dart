import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:liminal_desktop/audio/speech_output.dart';
import 'package:liminal_desktop/audio/tts_clip.dart';

class PlayerFixture implements AudioPlayer {
  ProcessingState state = ProcessingState.ready;
  int stops = 0;
  final playback = Completer<void>();
  final states = StreamController<ProcessingState>.broadcast();
  @override
  dynamic noSuchMethod(Invocation invocation) {
    switch (invocation.memberName) {
      case #setVolume: case #dispose: return Future<void>.value();
      case #setUrl: return Future<Duration?>.value(const Duration(milliseconds: 100));
      case #processingState: return state;
      case #processingStateStream: return states.stream;
      case #duration: return const Duration(milliseconds: 100);
      case #play: return playback.future;
      case #stop: stops++; return Future<void>.value();
    }
    return super.noSuchMethod(invocation);
  }
}

void main() {
  for (final failure in ['missing-completion', 'never-ready', 'stalled-download']) {
    testWidgets('TTS $failure cannot suspend dictation forever', (tester) async {
      final player = PlayerFixture();
      if (failure == 'never-ready') player.state = ProcessingState.loading;
      final output = SpeechOutput(player: player);
      final holds = <bool>[];
      var micUnblocked = false;
      output.onPlaybackHoldChange = holds.add;
      output.onMicCaptureUnblocked = () { micUnblocked = true; };
      if (failure == 'stalled-download') {
        output.setClipFetcher((_) => Completer<TtsClipBytes>().future);
      }
      output.enqueue(SpeechQueueItem(clipId: 'abc', text: 'reply', audioUrl: 'fixture.wav'));
      await tester.pump();
      expect(output.isTtsPipelineActive, isTrue);
      await tester.pump(const Duration(seconds: 35));
      expect(output.isTtsPipelineActive, isFalse);
      expect(holds, [true, false]);
      await tester.pump(const Duration(seconds: 2));
      expect(micUnblocked, isTrue);
      if (failure == 'missing-completion') expect(player.stops, greaterThan(0));
      output.dispose();await player.states.close();await tester.pump();
    });
  }
  testWidgets('normal playback releases the mic as soon as playback finishes', (tester) async {
    final player = PlayerFixture();final output = SpeechOutput(player: player);
    output.enqueue(SpeechQueueItem(clipId: 'abc', text: 'reply', audioUrl: 'fixture.wav'));
    await tester.pump();player.playback.complete();await tester.pump();
    expect(output.isTtsPipelineActive, isFalse);
    await tester.pump(const Duration(seconds: 2));
    output.dispose();await player.states.close();
  });
}
