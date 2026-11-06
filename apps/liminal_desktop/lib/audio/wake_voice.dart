/// Wake matching is deliberately exact: no fuzzy match on ordinary conversation.
class WakeVoiceSettings {
  const WakeVoiceSettings({
    this.enabled = false,
    this.phrase = 'Hey Jarvis',
    this.idleTimeoutMs = 45000,
  });
  final bool enabled;
  final String phrase;
  final int idleTimeoutMs;

  factory WakeVoiceSettings.fromJson(Map<String, dynamic>? json) =>
      WakeVoiceSettings(
        enabled: json?['enabled'] == true,
        phrase: (json?['phrase'] as String?)?.trim() ?? 'Hey Jarvis',
        idleTimeoutMs: ((json?['idleTimeoutMs'] as num?)?.toInt() ?? 45000)
            .clamp(10000, 300000),
      );
}

class WakeVoiceDecision {
  const WakeVoiceDecision({
    this.woke = false,
    this.slept = false,
    this.command,
  });
  final bool woke;
  final bool slept;
  final String? command;
}

class WakeVoiceGate {
  WakeVoiceGate(this.settings);
  WakeVoiceSettings settings;
  bool awake = false;
  int _lastActivity = 0;
  static final _word = RegExp(r'[\p{L}\p{N}]+', unicode: true);
  static final _leading = RegExp(r'^[\s,:;.!?\-—]+', unicode: true);

  void touch(int now) {
    if (awake) _lastActivity = now;
  }

  void sleep() {
    awake = false;
  }

  bool expire(int now) {
    if (!awake || now - _lastActivity < settings.idleTimeoutMs) return false;
    sleep();
    return true;
  }

  WakeVoiceDecision accept(String transcript, int now) {
    if (!settings.enabled) return const WakeVoiceDecision();
    final expired = expire(now);
    final text = transcript.trim();
    final words = _word.allMatches(text).toList();
    final phrase = _word
        .allMatches(settings.phrase)
        .map((m) => m.group(0)!.toLowerCase())
        .toList();
    if (words.isEmpty || phrase.isEmpty) {
      return WakeVoiceDecision(slept: expired);
    }
    final startsWithWake =
        words.length >= phrase.length &&
        List.generate(
          phrase.length,
          (i) => words[i].group(0)!.toLowerCase() == phrase[i],
        ).every((v) => v);
    if (!awake && !startsWithWake) return WakeVoiceDecision(slept: expired);
    final woke = !awake;
    final command = startsWithWake
        ? text
              .substring(words[phrase.length - 1].end)
              .replaceFirst(_leading, '')
              .trim()
        : text;
    final normalized = _word
        .allMatches(command)
        .map((m) => m.group(0)!.toLowerCase())
        .join(' ');
    if (normalized == 'go to sleep' || normalized == 'stop listening') {
      sleep();
      return const WakeVoiceDecision(slept: true);
    }
    awake = true;
    touch(now);
    return WakeVoiceDecision(
      woke: woke,
      command: command.isEmpty ? null : command,
    );
  }
}
