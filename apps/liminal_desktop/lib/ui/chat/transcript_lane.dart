import 'package:flutter/material.dart';

import '../../core/chat_visibility.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

export '../../core/chat_visibility.dart'
    show isHarnessLaneMessage, isConversationMessage;

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
