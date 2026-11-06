import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:liminal_desktop/audio/speech_output.dart';
import 'package:liminal_desktop/audio/tts_clip.dart';

class PlayerFixture implements AudioPlayer {
  ProcessingState state = ProcessingState.ready;
  int stops = 0;
  var playback = Completer<void>();
  bool nativePlaying = false;
  bool completePlayEarly = false;
  void Function()? onPlay;
  AudioSource? source;
  int loads = 0;
  final states = StreamController<ProcessingState>.broadcast();
  @override
  dynamic noSuchMethod(Invocation invocation) {
    switch (invocation.memberName) {
      case #setVolume: case #dispose: return Future<void>.value();
      case #setUrl:
        if (state == ProcessingState.completed) state = ProcessingState.ready;
        return Future<Duration?>.value(const Duration(milliseconds: 100));
      case #setAudioSource:
        source = invocation.positionalArguments.first as AudioSource;
        loads++;
        if (state == ProcessingState.completed) state = ProcessingState.ready;
        return Future<Duration?>.value(const Duration(milliseconds: 100));
      case #currentIndexStream: return Stream<int?>.value(0);
      case #durationStream: return Stream<Duration?>.value(const Duration(milliseconds: 100));
      case #position: return Duration.zero;
      case #processingState: return state;
      case #processingStateStream: return states.stream;
      case #duration: return const Duration(milliseconds: 100);
      case #play:
        onPlay?.call();
        if (nativePlaying) return Future<void>.value();
        nativePlaying = true; return completePlayEarly ? Future<void>.value() : playback.future;
      case #stop: nativePlaying = false; stops++; return Future<void>.value();
    }
    return super.noSuchMethod(invocation);
  }
}

void main() {
  testWidgets('interrupt discards a continuation waiting to join the playlist', (tester) async {
    final player = PlayerFixture();
    final output = SpeechOutput(player: player, gapless: true);
    output.enqueue(SpeechQueueItem(clipId: 'a', text: 'First.', audioUrl: 'first.wav'));
    await tester.pump();
    final playlist = player.source as ConcatenatingAudioSource;
    output.enqueue(SpeechQueueItem(clipId: 'b', text: 'Cancelled.', audioUrl: 'second.wav'));
    output.interrupt();
    await tester.pump();
    expect(playlist.children.length, 1);
    expect(output.queueLength, 0);
    expect(output.isTtsPipelineActive, isFalse);
    output.dispose(); await player.states.close();
  });
  testWidgets('continuation appends to the playing native playlist without stop or reload', (tester) async {
    final player = PlayerFixture();
    final output = SpeechOutput(player: player, gapless: true);
    final holds = <bool>[];
    output.onPlaybackHoldChange = holds.add;
    output.enqueue(SpeechQueueItem(clipId: 'a', text: 'First sentence.', audioUrl: 'first.wav'));
    await tester.pump();
    output.enqueue(SpeechQueueItem(clipId: 'b', text: 'Next sentence.', audioUrl: 'second.wav'));
    await tester.pump();
    expect((player.source as ConcatenatingAudioSource).children.length, 2);
    expect(player.loads, 1);
    expect(player.stops, 0);
    expect(holds, [true]);
    player.state = ProcessingState.completed;
    player.states.add(ProcessingState.completed);
    player.playback.complete();
    await tester.pump();
    expect(player.stops, 1);
    expect(output.isTtsPipelineActive, isFalse);
    expect(holds, [true, false]);
    await tester.pump(const Duration(seconds: 2));
    output.dispose(); await player.states.close();
  });
  testWidgets('interrupt cancels server synthesis as well as local playback', (tester) async {
    final player = PlayerFixture();
    final output = SpeechOutput(player: player);
    var cancelled = 0;
    output.onInterrupted = () { cancelled++; };
    output.interrupt();
    expect(cancelled, 1);
    expect(output.queueLength, 0);
    expect(output.isTtsPipelineActive, isFalse);
    output.dispose();
    await player.states.close();
  });
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
    await tester.pump();player.state=ProcessingState.completed;player.states.add(ProcessingState.completed);player.playback.complete();await tester.pump();
    expect(output.isTtsPipelineActive, isFalse);
    await tester.pump(const Duration(seconds: 2));
    output.dispose();await player.states.close();
  });
  testWidgets('consecutive replies stop native playback state before loading the next clip', (tester) async {
    final player = PlayerFixture();final output = SpeechOutput(player: player);
    for (var i=0;i<2;i++) {
      player.playback = Completer<void>();
      output.enqueue(SpeechQueueItem(clipId: 'clip$i', text: 'reply', audioUrl: 'fixture.wav'));
      await tester.pump();expect(output.isTtsPipelineActive, isTrue);
      player.state=ProcessingState.completed;player.states.add(ProcessingState.completed);player.playback.complete();await tester.pump();
      expect(output.isTtsPipelineActive, isFalse);
      expect(player.nativePlaying, isFalse, reason: 'just_audio playing stays true at completion until stop/pause');
    }
    await tester.pump(const Duration(seconds: 2));
    output.dispose();await player.states.close();
  });
}
