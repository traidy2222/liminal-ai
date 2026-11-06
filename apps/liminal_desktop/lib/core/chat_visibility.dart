import '../state/message_models.dart';

/// Harness-only lines hidden in clean chat. **Tool activity always stays visible**
/// (`ToolCallMessage` compact rows). Only duplicate `ToolResultMessage` entries
/// are stripped (output is merged onto the tool row).
bool isHarnessInternalMessage(MessageEntry e) =>
    e is TraceMessage ||
    e is ProviderRetryMessage ||
    e is ContextCompressedMessage ||
    e is WorkingStateMessage;

bool isHarnessLaneMessage(MessageEntry entry) =>
    entry is ToolCallMessage ||
    entry is ThinkMessage ||
    entry is ReasonMessage ||
    entry is ModelReasoningMessage ||
    entry is PlanMessage ||
    entry is SubtaskMessage;

bool isConversationMessage(MessageEntry entry) =>
    entry is UserMessage || entry is AssistantMessage;

/// Transcript filter when `showRawHarness` is false (clean chat).
List<MessageEntry> visibleChatMessages(
  List<MessageEntry> messages, {
  required bool showRawHarness,
}) {
  final nonempty = messages
      .where((e) => e is! AssistantMessage || e.text.trim().isNotEmpty)
      .toList();
  if (showRawHarness) return nonempty;
  return [
    for (final e in nonempty)
      if (e is! ToolResultMessage &&
          (!isHarnessInternalMessage(e) || e is ProviderRetryMessage))
        e,
  ];
}
