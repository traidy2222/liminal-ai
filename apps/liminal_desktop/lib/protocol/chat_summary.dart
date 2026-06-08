/// Mirrors `@liminal/protocol` ChatSummary.
class ChatSummary {
  ChatSummary({
    required this.chatId,
    required this.title,
    required this.workspaceRoot,
    required this.updatedAt,
    required this.busy,
    required this.active,
    required this.awaitingPersonaBootstrap,
    this.kind,
  });

  final String chatId;
  final String title;
  final String? kind;
  final String workspaceRoot;
  final int updatedAt;
  final bool busy;
  final bool active;
  final bool awaitingPersonaBootstrap;

  factory ChatSummary.fromJson(Map<String, dynamic> json) {
    return ChatSummary(
      chatId: json['chatId'] as String,
      title: json['title'] as String? ?? 'Chat',
      kind: json['kind'] as String?,
      workspaceRoot: json['workspaceRoot'] as String? ?? '',
      updatedAt: (json['updatedAt'] as num?)?.toInt() ?? 0,
      busy: json['busy'] as bool? ?? false,
      active: json['active'] as bool? ?? false,
      awaitingPersonaBootstrap:
          json['awaitingPersonaBootstrap'] as bool? ?? false,
    );
  }

  bool get isOrchestrator => kind == 'orchestrator';
}
