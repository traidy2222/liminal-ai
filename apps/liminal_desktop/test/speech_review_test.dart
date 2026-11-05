import 'dart:async';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:just_audio/just_audio.dart';
import 'package:liminal_desktop/audio/speech_output.dart';
import 'package:liminal_desktop/audio/sidecar_audio_client.dart';
import 'speech_recovery_test.dart' show PlayerFixture;

void main() {
  testWidgets('review readiness timeout cancels subscription', (tester) async {
    final player=PlayerFixture()..state=ProcessingState.loading;
    final output=SpeechOutput(player:player);
    try {
      output.enqueue(SpeechQueueItem(clipId:'abc',text:'reply',audioUrl:'fixture.wav'));
      await tester.pump();expect(player.states.hasListener,isTrue);
      await tester.pump(const Duration(seconds:16));
      expect(player.states.hasListener,isFalse,reason:'Readiness timeout must cancel its stream listener');
    } finally {
      await tester.pump(const Duration(seconds:2));output.dispose();await player.states.close();await tester.pump();
    }
  });
  testWidgets('review early play response retains hold until completed', (tester) async {
    final player=PlayerFixture()..completePlayEarly=true;
    var subscribedBeforePlay=false;
    player.onPlay=()=>subscribedBeforePlay=player.states.hasListener;
    final output=SpeechOutput(player:player);
    try {
      output.enqueue(SpeechQueueItem(clipId:'abc',text:'reply',audioUrl:'fixture.wav'));
      await tester.pump();
      expect(output.isTtsPipelineActive,isTrue,reason:'media-kit play() can finish before the audible clip');
      expect(subscribedBeforePlay,isTrue);
      player.state=ProcessingState.completed;player.states.add(ProcessingState.completed);
      await tester.pump();expect(output.isTtsPipelineActive,isFalse);
      expect(player.states.hasListener,isFalse);
    } finally {
      await tester.pump(const Duration(seconds:2));output.dispose();await player.states.close();await tester.pump();
    }
  });
  test('review clip deadline closes the underlying socket', () async {
    final overrides=HttpOverrides.current;HttpOverrides.global=null;
    final server=await ServerSocket.bind(InternetAddress.loopbackIPv4,0);
    final sockets=<Socket>[];final received=Completer<void>();final disconnected=Completer<void>();
    server.listen((socket){
      sockets.add(socket);var sent=false;
      socket.listen((data){if(sent)return;sent=true;
        socket.write('HTTP/1.1 200 OK\r\nContent-Type: audio/wav\r\nContent-Length: 1000\r\n\r\npartial');
        socket.flush();received.complete();
      },onDone:(){if(!disconnected.isCompleted)disconnected.complete();},onError:(Object _){if(!disconnected.isCompleted)disconnected.complete();});
    });
    Object? failure;
    final client=SidecarAudioClient(port:server.port,token:'fixture',chatId:'test',clipTimeout:const Duration(milliseconds:80));
    final request=client.fetchTtsClip('/api/tts/clip/fixture').then<void>((_) {},onError:(Object e){failure=e;});
    try {
      await received.future.timeout(const Duration(seconds:3));
      await Future<void>.delayed(const Duration(milliseconds:300));
      expect(failure,isA<TimeoutException>(),reason:'The request itself must own its deadline');
      await disconnected.future.timeout(const Duration(seconds:2));
    } finally {
      for(final socket in sockets)socket.destroy();await server.close();await request;
      HttpOverrides.global=overrides;
    }
  });
}
