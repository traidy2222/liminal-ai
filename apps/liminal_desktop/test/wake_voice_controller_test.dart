import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:record/record.dart';
import 'package:liminal_desktop/audio/dictation_controller.dart';
import 'package:liminal_desktop/audio/sidecar_audio_client.dart';
import 'package:liminal_desktop/audio/wake_voice.dart';
import 'package:liminal_desktop/audio/wake_voice_controller.dart';
import 'asr_review_test.dart' show RecorderFixture;

class Capture extends DictationController {
  @override
  Future<void> startSession() async {
    sessionActive = true;
    status = DictationStatus.listening;
  }

  @override
  Future<void> endSession() async {
    sessionActive = false;
    status = DictationStatus.idle;
  }

  @override
  void bindAudioClient(SidecarAudioClient? client) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late RecordPlatform previous;
  setUp(() {
    previous = RecordPlatform.instance;
    RecordPlatform.instance = RecorderFixture();
  });
  tearDown(() {
    RecordPlatform.instance = previous;
  });

  test(
    'only wake requests route to Mission Control; queued followups drain once after busy',
    () async {
      var busy = false, now = 100;
      final sent = <String>[], sessions = <bool>[];
      final voice = WakeVoiceController(
        recorder: Capture(),
        now: () => now,
        onWake: (_) async {},
        onAwakeChanged: (_, active) async {
          sessions.add(active);
        },
        isBusy: (_) => busy,
        isPlaying: () => false,
        send: (chat, text) async {
          expect(chat, 'mission-control');
          sent.add(text);
          return const WakeSendResult(accepted: true);
        },
      );
      await voice.configure(const WakeVoiceSettings(enabled: true));
      await voice.start(
        SidecarAudioClient(port: 1, token: '', chatId: 'mission-control'),
      );
      try {
        await voice.acceptTranscript(
          'This is a private background conversation.',
        );
        expect(sent, isEmpty);
        await voice.acceptTranscript('Hey Jarvis, delegate this task.');
        busy = true;
        await voice.acceptTranscript('How are the workers doing?');
        now = 200000;
        voice.tick();
        expect(
          voice.awake,
          isTrue,
          reason: 'agent activity must not expire the conversation',
        );
        expect(sent, ['delegate this task.']);
        busy = false;
        await voice.drain();
        await voice.drain();
        expect(sent, ['delegate this task.', 'How are the workers doing?']);
        await voice.acceptTranscript('go to sleep');
        expect(sessions, [true, false]);
        await voice.acceptTranscript('background again');
        expect(sent.length, 2);
      } finally {
        await voice.stop();
        voice.dispose();
        await Future<void>.delayed(Duration.zero);
      }
    },
  );

  test(
    'uncertain acknowledgements retain the command without automatically replaying it',
    () async {
      var attempts = 0;
      final voice = WakeVoiceController(
        recorder: Capture(),
        onWake: (_) async {},
        onAwakeChanged: (_, __) async {},
        isBusy: (_) => false,
        isPlaying: () => false,
        send: (_, __) async {
          attempts++;
          return const WakeSendResult(
            error: 'Connection lost before acknowledgement',
          );
        },
      );
      await voice.configure(const WakeVoiceSettings(enabled: true));
      await voice.start(
        SidecarAudioClient(port: 1, token: '', chatId: 'orchestrator'),
      );
      try {
        await voice.acceptTranscript('Hey Jarvis, create the file.');
        voice.tick();
        await voice.drain();
        expect(attempts, 1);
        expect(voice.pendingCount, 1);
        expect(voice.error, contains('Connection lost'));
      } finally {
        await voice.stop();
        voice.dispose();
        await Future<void>.delayed(Duration.zero);
      }
    },
  );

  test(
    'disabling while wake activation is pending cannot send a stale request',
    () async {
      final ready = Completer<void>();
      var sends = 0;
      final voice = WakeVoiceController(
        recorder: Capture(),
        onWake: (_) => ready.future,
        onAwakeChanged: (_, __) async {},
        isBusy: (_) => false,
        isPlaying: () => false,
        send: (_, __) async {
          sends++;
          return const WakeSendResult(accepted: true);
        },
      );
      await voice.configure(const WakeVoiceSettings(enabled: true));
      await voice.start(
        SidecarAudioClient(port: 1, token: '', chatId: 'orchestrator'),
      );
      final pending = voice.acceptTranscript('Hey Jarvis, do the task.');
      await Future<void>.delayed(Duration.zero);
      await voice.configure(const WakeVoiceSettings(enabled: false));
      ready.complete();
      await pending;
      expect(sends, 0);
      expect(voice.listening, isFalse);
      voice.dispose();
      await Future<void>.delayed(Duration.zero);
    },
  );

  test(
    'pause closes capture without waiting for a stalled voice-session acknowledgement',
    () async {
      final acknowledgement = Completer<void>();
      final voice = WakeVoiceController(
        recorder: Capture(),
        onWake: (_) async {},
        onAwakeChanged: (_, active) =>
            active ? Future.value() : acknowledgement.future,
        isBusy: (_) => false,
        isPlaying: () => false,
        send: (_, __) async => const WakeSendResult(accepted: true),
      );
      await voice.configure(const WakeVoiceSettings(enabled: true));
      await voice.start(
        SidecarAudioClient(port: 1, token: '', chatId: 'orchestrator'),
      );
      await voice.acceptTranscript('Hey Jarvis');
      await voice.pause().timeout(const Duration(seconds: 1));
      expect(voice.listening, isFalse);
      expect(voice.awake, isFalse);
      acknowledgement.complete();
      await Future<void>.delayed(Duration.zero);
      voice.dispose();
      await Future<void>.delayed(Duration.zero);
    },
  );
}
