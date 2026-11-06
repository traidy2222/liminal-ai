import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/audio/wake_voice.dart';

void main() {
  WakeVoiceGate gate() => WakeVoiceGate(const WakeVoiceSettings(enabled: true));
  test(
    'standby ignores normal conversation, substring matches and mentioned wake words',
    () {
      final voice = gate();
      for (final text in [
        'What is the weather?',
        'Tell Hey Jarvis to do it',
        'Hey Jarvisian, hello',
        '',
      ]) {
        expect(voice.accept(text, 0).command, isNull);
        expect(voice.awake, isFalse);
      }
    },
  );
  test(
    'wake phrase and inline request preserve punctuation and paths; followups need no phrase',
    () {
      final voice = gate();
      final first = voice.accept(
        'HEY, Jarvis! Review C:\\Games\\demo.exe, please.',
        100,
      );
      expect(first.woke, isTrue);
      expect(first.command, 'Review C:\\Games\\demo.exe, please.');
      final next = voice.accept('What are your workers doing?', 1000);
      expect(next.woke, isFalse);
      expect(next.command, 'What are your workers doing?');
    },
  );
  test(
    'standalone wake, explicit sleep and timeout cannot send incidental speech',
    () {
      final voice = gate();
      expect(voice.accept('Hey Jarvis.', 0).woke, isTrue);
      expect(
        voice.accept('Explain what go to sleep means.', 500).command,
        isNotNull,
      );
      expect(voice.accept('Go to sleep.', 1000).slept, isTrue);
      expect(voice.accept('Do this now.', 2000).command, isNull);
      voice.accept('Hey Jarvis', 3000);
      expect(voice.accept('ordinary conversation', 50000).slept, isTrue);
      expect(voice.awake, isFalse);
    },
  );
  test(
    'custom phrases are literal and busy activity extends the follow-up window',
    () {
      final voice = WakeVoiceGate(
        const WakeVoiceSettings(enabled: true, phrase: 'Okay Liminal'),
      );
      expect(voice.accept('Hey Jarvis, hello', 0).command, isNull);
      expect(
        voice.accept('Okay Liminal, start the task.', 10).command,
        'start the task.',
      );
      voice.touch(100000);
      expect(voice.expire(120000), isFalse);
      expect(voice.expire(145001), isTrue);
    },
  );
}
