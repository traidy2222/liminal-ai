import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

bool isHarnessLaneMessage(MessageEntry entry) =>
    entry is ToolCallMessage ||
    entry is ThinkMessage ||
    entry is ReasonMessage ||
    entry is ModelReasoningMessage ||
    entry is PlanMessage ||
    entry is SubtaskMessage;

bool isConversationMessage(MessageEntry entry) =>
    entry is UserMessage || entry is AssistantMessage;

/// Inset rail for tools, reasoning, and agent activity between conversation turns.
class TranscriptActivityLane extends StatelessWidget {
  const TranscriptActivityLane({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(
        left: LiminalSpacing.sm,
        right: LiminalSpacing.xxs,
        bottom: LiminalSpacing.xs,
      ),
      child: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(
            left: BorderSide(
              color: lim.textDim.withValues(alpha: 0.45),
              width: 2,
            ),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.only(left: LiminalSpacing.sm),
          child: child,
        ),
      ),
    );
  }
}
