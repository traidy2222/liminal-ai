import '../state/message_models.dart';
import 'chat_visibility.dart';

sealed class TranscriptSegment {}

class TranscriptMessageSegment extends TranscriptSegment {
  TranscriptMessageSegment(this.entry);
  final MessageEntry entry;
}

/// Consecutive harness-lane rows (tools, reasoning, plans, subtasks).
class TranscriptActivityGroupSegment extends TranscriptSegment {
  TranscriptActivityGroupSegment(this.entries);
  final List<MessageEntry> entries;
}

/// Groups back-to-back activity rows into one collapsible working block.
List<TranscriptSegment> groupTranscriptActivity(List<MessageEntry> messages) {
  final out = <TranscriptSegment>[];
  var i = 0;
  while (i < messages.length) {
    final m = messages[i];
    if (!isHarnessLaneMessage(m)) {
      out.add(TranscriptMessageSegment(m));
      i++;
      continue;
    }
    final group = <MessageEntry>[m];
    i++;
    while (i < messages.length && isHarnessLaneMessage(messages[i])) {
      group.add(messages[i]);
      i++;
    }
    out.add(TranscriptActivityGroupSegment(group));
  }
  return out;
}

class ActivityGroupSummary {
  const ActivityGroupSummary({
    required this.toolCount,
    required this.runningCount,
    required this.errorCount,
    required this.activeToolName,
    required this.isActive,
  });

  final int toolCount;
  final int runningCount;
  final int errorCount;
  final String? activeToolName;
  final bool isActive;
}

ActivityGroupSummary summarizeActivityGroup(List<MessageEntry> entries) {
  final tools = entries.whereType<ToolCallMessage>().toList();
  var running = 0;
  var errors = 0;
  String? activeName;
  for (final t in tools) {
    switch (t.status) {
      case ToolCallStatus.streaming:
      case ToolCallStatus.running:
      case ToolCallStatus.pendingApproval:
        running++;
        activeName ??= t.name;
      case ToolCallStatus.error:
        errors++;
      case ToolCallStatus.done:
        break;
    }
  }
  final reasoningActive = entries.any((e) {
    if (e is ThinkMessage) return e.streaming;
    if (e is ReasonMessage) return e.streaming;
    if (e is ModelReasoningMessage) return e.streaming;
    if (e is PlanMessage) return e.streaming;
    return false;
  });
  return ActivityGroupSummary(
    toolCount: tools.length,
    runningCount: running,
    errorCount: errors,
    activeToolName: activeName,
    isActive: running > 0 || reasoningActive,
  );
}

String activityGroupSubtitle(ActivityGroupSummary summary) {
  if (summary.toolCount == 0) {
    return summary.isActive ? 'Reasoning…' : 'Reasoning complete';
  }
  final parts = <String>[];
  if (summary.toolCount > 0) {
    parts.add(
      summary.toolCount == 1 ? '1 tool' : '${summary.toolCount} tools',
    );
  }
  if (summary.runningCount > 0) {
    parts.add('${summary.runningCount} running');
  }
  if (summary.errorCount > 0) {
    parts.add('${summary.errorCount} failed');
  }
  if (summary.activeToolName != null && summary.runningCount > 0) {
    parts.add(summary.activeToolName!);
  }
  return parts.join(' · ');
}
