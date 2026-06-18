import '../state/message_models.dart';

/// True when the session is busy but the transcript has no substantive agent output
/// after the latest user message (common during long provider / tool latency).
bool chatAwaitingVisibleActivity(List<MessageEntry> messages, {required bool busy}) {
  if (!busy) return false;
  var lastUser = -1;
  for (var i = 0; i < messages.length; i++) {
    if (messages[i] is UserMessage) lastUser = i;
  }
  if (lastUser < 0) return messages.isEmpty;

  for (var i = lastUser + 1; i < messages.length; i++) {
    final m = messages[i];
    if (m is AssistantMessage && m.text.trim().isNotEmpty) return false;
    if (m is ToolCallMessage) return false;
    if (m is PlanMessage) return false;
    if (m is ModelReasoningMessage && m.text.trim().isNotEmpty) return false;
    if (m is ThinkMessage &&
        (m.content.trim().isNotEmpty || m.argsPreview.trim().isNotEmpty)) {
      return false;
    }
    if (m is ReasonMessage &&
        (m.inference.trim().isNotEmpty || m.argsPreview.trim().isNotEmpty)) {
      return false;
    }
  }
  return true;
}

String? latestProviderRetryHint(List<MessageEntry> messages) {
  for (var i = messages.length - 1; i >= 0; i--) {
    final m = messages[i];
    if (m is ProviderRetryMessage) return m.detail;
  }
  return null;
}
