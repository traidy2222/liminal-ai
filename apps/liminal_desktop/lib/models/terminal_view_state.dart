/// Wire payload for sidecar `terminal_view` events.
class TerminalViewWire {
  const TerminalViewWire({
    required this.chatId,
    required this.sessionId,
    required this.label,
    required this.source,
    required this.cwd,
    required this.open,
    required this.focus,
    required this.updatedAt,
  });

  final String chatId;
  final String sessionId;
  final String label;
  final String source;
  final String cwd;
  final bool open;
  final bool focus;
  final int updatedAt;

  factory TerminalViewWire.fromJson(Map<String, dynamic> data) {
    return TerminalViewWire(
      chatId: data['chatId'] as String? ?? '',
      sessionId: data['sessionId'] as String? ?? '',
      label: data['label'] as String? ?? 'Terminal',
      source: data['source'] as String? ?? 'agent',
      cwd: data['cwd'] as String? ?? '',
      open: data['open'] as bool? ?? true,
      focus: data['focus'] as bool? ?? true,
      updatedAt: (data['updatedAt'] as num?)?.toInt() ?? 0,
    );
  }
}
