/// Chat transcript entries — aligned with web `useSSE.ts` `MessageEntry` (subset + growth).
sealed class MessageEntry {}

class UserMessage extends MessageEntry {
  UserMessage(
    this.text, {
    this.attachmentPreviews = const [],
  });

  final String text;
  final List<UserAttachmentPreview> attachmentPreviews;
}

/// Display-only chip for images the user sent this turn.
class UserAttachmentPreview {
  const UserAttachmentPreview({required this.name});
  final String name;
}

class AssistantMessage extends MessageEntry {
  AssistantMessage({required this.text, this.streaming = false});
  String text;
  bool streaming;
}

class ModelReasoningMessage extends MessageEntry {
  ModelReasoningMessage({required this.text, this.streaming = false});
  String text;
  bool streaming;
}

class TraceMessage extends MessageEntry {
  TraceMessage(this.text);
  final String text;
}

class ThinkMessage extends MessageEntry {
  ThinkMessage({
    required this.callId,
    this.streaming = false,
    this.content = '',
    this.argsPreview = '',
  });

  final String callId;
  bool streaming;
  String content;
  String argsPreview;
}

class ReasonMessage extends MessageEntry {
  ReasonMessage({
    required this.callId,
    this.streaming = false,
    this.inference = '',
    this.argsPreview = '',
    this.confidence,
  });

  final String callId;
  bool streaming;
  String inference;
  String argsPreview;
  final String? confidence;
}

class PlanMessage extends MessageEntry {
  PlanMessage({
    required this.callId,
    this.streaming = false,
    this.steps = const [],
    this.argsPreview = '',
  });

  final String callId;
  bool streaming;
  List<String> steps;
  String argsPreview;
}

class ToolCallMessage extends MessageEntry {
  ToolCallMessage({
    required this.callId,
    required this.name,
    required this.status,
    this.argsPreview = '',
    this.output,
    this.startedAt,
  });

  final String callId;
  final String name;
  ToolCallStatus status;
  String argsPreview;
  String? output;
  final int? startedAt;
}

enum ToolCallStatus { streaming, pendingApproval, running, done, error }

class ToolResultMessage extends MessageEntry {
  ToolResultMessage({
    required this.callId,
    required this.output,
    required this.ok,
  });

  final String callId;
  final String output;
  final bool ok;
}

class TurnHeaderMessage extends MessageEntry {
  TurnHeaderMessage({
    required this.intentClass,
    required this.outcomeScore,
    required this.toolCount,
    required this.durationMs,
    required this.keyTools,
    required this.terminationReason,
  });

  final String intentClass;
  final double outcomeScore;
  final int toolCount;
  final int durationMs;
  final List<String> keyTools;
  final String terminationReason;
}

class WorkingStateMessage extends MessageEntry {
  WorkingStateMessage({
    this.goal,
    this.driftScore,
    this.subgoalsPreview,
    this.executionPreview,
  });

  final String? goal;
  final double? driftScore;
  final String? subgoalsPreview;
  final String? executionPreview;
}

class ContextCompressedMessage extends MessageEntry {
  ContextCompressedMessage({
    required this.beforePct,
    required this.afterPct,
    required this.rounds,
  });

  final double beforePct;
  final double afterPct;
  final int rounds;
}

class SubtaskMessage extends MessageEntry {
  SubtaskMessage({
    required this.taskId,
    required this.parentTaskId,
    required this.goal,
    required this.depth,
    required this.status,
    this.partialOutput = '',
    this.finalOutput,
  });

  final String taskId;
  final String parentTaskId;
  final String goal;
  final int depth;
  SubtaskStatus status;
  String partialOutput;
  String? finalOutput;
}

enum SubtaskStatus { running, done, error, cancelled }

class ErrorMessage extends MessageEntry {
  ErrorMessage(this.message);
  final String message;
}

class ProviderRetryMessage extends MessageEntry {
  ProviderRetryMessage(this.detail);
  final String detail;
}

class PendingApproval {
  PendingApproval({
    required this.callId,
    required this.name,
    required this.args,
    required this.approvalNonce,
    required this.approvalTimeoutMs,
  });

  final String callId;
  final String name;
  final Map<String, dynamic> args;
  final String approvalNonce;
  final int approvalTimeoutMs;
}

class PendingAskUser {
  PendingAskUser(this.prompt);
  final String prompt;
}
