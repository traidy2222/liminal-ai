import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter/material.dart';
import 'package:record/record.dart';
import 'package:liminal_desktop/audio/dictation_controller.dart';
import 'package:liminal_desktop/audio/sidecar_audio_client.dart';
import 'package:liminal_desktop/core/session_registry.dart';
import 'package:liminal_desktop/ui/widgets/composer.dart';
import 'package:liminal_desktop/ui/theme/liminal_theme.dart';
import 'asr_review_test.dart' show RecorderFixture;

class SequenceClient extends SidecarAudioClient {
  SequenceClient({this.failFirst = false})
      : super(port: 1, token: '', chatId: 'test');
  final bool failFirst;
  int decodes = 0;
  @override
  Future<String> uploadWavBytes(Uint8List bytes,
          {String filename = 'dictation.wav'}) async =>
      'clip';
  @override
  Future<String> preview(Uint8List wav) async => 'partial';
  @override
  Future<TranscribeResult?> transcribe(String id) async {
    decodes++;
    if (failFirst && decodes == 1)
      throw const HttpException('Temporary decode failure');
    return TranscribeResult(text: 'utterance $decodes');
  }
}

Future<void> waitUntil(bool Function() predicate) async {
  for (var i = 0; i < 70 && !predicate(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
  expect(predicate(), isTrue);
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  for (final failFirst in [false, true]) {
    test(
        'pause sends consecutive utterances; decode failure=$failFirst keeps mic armed',
        () async {
      final previous = RecordPlatform.instance;
      final recorder = RecorderFixture();
      RecordPlatform.instance = recorder;
      final client = SequenceClient(failFirst: failFirst);
      final controller = DictationController(
          endpointOptions: const DictationEndpointOptions(
              minRecordingMs: 100, silenceMsShort: 150, silenceMsLong: 150))
        ..bindAudioClient(client);
      final sent = <String>[];
      final capture = <bool>[];
      controller.onAutoSend = (text) async {
        sent.add(text);
      };
      controller.onCaptureActiveChange = capture.add;
      try {
        await controller.startSession();
        await Future<void>.delayed(const Duration(milliseconds: 750));
        for (var turn = 1; turn <= 3; turn++) {
          recorder.amplitude = -10;
          await waitUntil(() => controller.status == DictationStatus.recording);
          expect(capture.last, isTrue,
              reason: 'TTS must pause during speech, before upload');
          recorder.pcm.add(Uint8List(16000));
          recorder.amplitude = -70;
          await waitUntil(() =>
              client.decodes == turn &&
              controller.status == DictationStatus.listening);
          expect(controller.sessionActive, isTrue);
          expect(capture.last, isFalse);
        }
        expect(
            sent,
            failFirst
                ? ['utterance 2', 'utterance 3']
                : ['utterance 1', 'utterance 2', 'utterance 3']);
      } finally {
        await controller.endSession();
        controller.dispose();
        await Future<void>.delayed(const Duration(milliseconds: 20));
        await recorder.pcm.close();
        RecordPlatform.instance = previous;
      }
    });
  }
  test(
      'turn settlement observes cleared busy state and preserves the originating chat',
      () {
    final sessions = SessionRegistry();
    final ready = <String>[];
    sessions.sessionFor('first').applyUserMessage('hello');
    sessions.sessionFor('other').applyUserMessage('still running');
    sessions.onTurnSettled = (chat) {
      expect(sessions.get(chat)!.busy, isFalse);
      ready.add(chat);
    };
    sessions.dispatch('first', 'turn_end', {});
    expect(ready, ['first']);
    expect(sessions.get('other')!.busy, isTrue);
    sessions.dispatch('other', 'error', {'message': 'provider disconnected'});
    expect(ready, ['first', 'other']);
    sessions.disposeAll();
  });
  testWidgets('queued speech clears its composer span before the next utterance', (tester) async {
    final previous = RecordPlatform.instance;
    final recorder = RecorderFixture();
    RecordPlatform.instance = recorder;
    final controller = DictationController()..sessionActive = true;
    final messages = <String>[];
    try {
      await tester.pumpWidget(MaterialApp(theme: buildLiminalTheme(), home: Scaffold(body: Composer(
        enabled: true, busy: true, onSend: (text, attachments, {workflowPreset}) {}, onAbort: () {},
        dictation: controller, onDictationAutoSend: (text) async { messages.add(text); return 'queued'; },
      ))));
      controller.onInterim?.call('provisional first');
      await controller.onAutoSend!.call('final first');
      await tester.pump();
      expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, isEmpty);
      controller.onInterim?.call('provisional second');
      await controller.onAutoSend!.call('final second');
      expect(messages, ['final first', 'final second']);
      await tester.pumpWidget(const SizedBox());
    } finally {
      controller.dispose();
      await tester.pump();
      await recorder.pcm.close();
      RecordPlatform.instance = previous;
    }
  });
  test(
      'ending a session cancels a stalled upload, not only transcription requests',
      () async {
    final overrides = HttpOverrides.current;
    HttpOverrides.global = null;
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    final received = Completer<void>();
    server.listen((request) async {
      await request.drain<void>();
      received.complete();
    });
    final client =
        SidecarAudioClient(port: server.port, token: 'test', chatId: 'test');
    final upload = client.uploadWavBytes(Uint8List(2000));
    final failure = expectLater(upload, throwsA(isA<Exception>()));
    try {
      await received.future.timeout(const Duration(seconds: 3));
      client.cancelTranscriptionRequests();
      await failure.timeout(const Duration(seconds: 2));
    } finally {
      client.cancelTranscriptionRequests();
      await server.close(force: true);
      HttpOverrides.global = overrides;
    }
  });
}
