/// Live compose panel — files, email drafts, and sends.
enum FileEditPhase {
  streaming,
  pendingApproval,
  writing,
}

enum ComposeDockKind {
  file,
  email,
}

class FileEditViewState {
  const FileEditViewState({
    required this.open,
    required this.callId,
    required this.toolName,
    this.kind = ComposeDockKind.file,
    this.path,
    this.subject,
    this.recipients,
    this.bodyHtml,
    this.bodyPlain,
    this.content = '',
    this.charCount = 0,
    this.lineCount = 0,
    this.incomplete = true,
    this.phase = FileEditPhase.streaming,
    required this.updatedAt,
  });

  final bool open;
  final String callId;
  final String toolName;
  final ComposeDockKind kind;
  /// File path, or email subject line for the header subtitle.
  final String? path;
  final String? subject;
  final String? recipients;
  final String? bodyHtml;
  final String? bodyPlain;
  final String content;
  final int charCount;
  final int lineCount;
  final bool incomplete;
  final FileEditPhase phase;
  final int updatedAt;

  bool get isEmail => kind == ComposeDockKind.email;

  FileEditViewState copyWith({
    bool? open,
    String? callId,
    String? toolName,
    ComposeDockKind? kind,
    String? path,
    String? subject,
    String? recipients,
    String? bodyHtml,
    String? bodyPlain,
    String? content,
    int? charCount,
    int? lineCount,
    bool? incomplete,
    FileEditPhase? phase,
    int? updatedAt,
  }) {
    return FileEditViewState(
      open: open ?? this.open,
      callId: callId ?? this.callId,
      toolName: toolName ?? this.toolName,
      kind: kind ?? this.kind,
      path: path ?? this.path,
      subject: subject ?? this.subject,
      recipients: recipients ?? this.recipients,
      bodyHtml: bodyHtml ?? this.bodyHtml,
      bodyPlain: bodyPlain ?? this.bodyPlain,
      content: content ?? this.content,
      charCount: charCount ?? this.charCount,
      lineCount: lineCount ?? this.lineCount,
      incomplete: incomplete ?? this.incomplete,
      phase: phase ?? this.phase,
      updatedAt: updatedAt ?? this.updatedAt,
    );
  }
}
