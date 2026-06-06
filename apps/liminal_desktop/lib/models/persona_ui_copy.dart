/// Persona interface microcopy — mirrors `@liminal/core` `PersonaUiCopy`.
///
/// The app's chrome text in the persona's voice. Server already sanitizes and
/// length-clamps these; here we only parse, with per-field fallbacks so a
/// missing field never blanks the UI.
class PersonaUiCopy {
  const PersonaUiCopy({
    this.composerPlaceholder = 'Type a message…',
    this.sendLabel = 'Send',
    this.stopLabel = 'Stop',
    this.emptyTitle = 'Ready when you are',
    this.emptyBody = 'Ask anything, or start with a task.',
    this.thinkingLabel = 'Thinking…',
    this.connectingLabel = 'Connecting…',
    this.errorPrefix = 'Something went wrong',
    this.newChatLabel = 'New chat',
  });

  final String composerPlaceholder;
  final String sendLabel;
  final String stopLabel;
  final String emptyTitle;
  final String emptyBody;
  final String thinkingLabel;
  final String connectingLabel;
  final String errorPrefix;
  final String newChatLabel;

  static const fallback = PersonaUiCopy();

  factory PersonaUiCopy.fromJson(Map<String, dynamic>? json) {
    if (json == null || json.isEmpty) return fallback;
    String s(String key, String fb) {
      final v = json[key];
      return v is String && v.trim().isNotEmpty ? v.trim() : fb;
    }

    return PersonaUiCopy(
      composerPlaceholder: s('composerPlaceholder', fallback.composerPlaceholder),
      sendLabel: s('sendLabel', fallback.sendLabel),
      stopLabel: s('stopLabel', fallback.stopLabel),
      emptyTitle: s('emptyTitle', fallback.emptyTitle),
      emptyBody: s('emptyBody', fallback.emptyBody),
      thinkingLabel: s('thinkingLabel', fallback.thinkingLabel),
      connectingLabel: s('connectingLabel', fallback.connectingLabel),
      errorPrefix: s('errorPrefix', fallback.errorPrefix),
      newChatLabel: s('newChatLabel', fallback.newChatLabel),
    );
  }
}
