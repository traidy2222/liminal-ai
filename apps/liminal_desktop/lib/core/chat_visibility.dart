import '../state/message_models.dart';

/// Harness-only lines hidden in clean chat. **Tool activity always stays visible**
/// (`ToolCallMessage` compact rows). Only duplicate `ToolResultMessage` entries
/// are stripped (output is merged onto the tool row).
bool isHarnessInternalMessage(MessageEntry e) =>
    e is TraceMessage ||
    e is ProviderRetryMessage ||
    e is ContextCompressedMessage ||
    e is WorkingStateMessage;

/// Transcript filter when `showRawHarness` is false (clean chat).
List<MessageEntry> visibleChatMessages(
  List<MessageEntry> messages, {
  required bool showRawHarness,
}) {
  if (showRawHarness) return messages;
  return [
    for (final e in messages)
      if (!isHarnessInternalMessage(e) && e is! ToolResultMessage) e,
  ];
}
