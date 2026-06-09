import 'package:flutter/material.dart';

import '../../theme/liminal_theme_extension.dart';

enum LiminalBadgeTone { neutral, accent, success, warn, danger }

/// Compact status pill (Soon, Pro, Running, etc.).
class LiminalBadge extends StatelessWidget {
  const LiminalBadge({
    super.key,
    required this.label,
    this.tone = LiminalBadgeTone.neutral,
    this.icon,
  });

  final String label;
  final LiminalBadgeTone tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final (bg, fg, border) = switch (tone) {
      LiminalBadgeTone.accent => (
          lim.accent.withValues(alpha: 0.12),
          lim.accent,
          lim.accent.withValues(alpha: 0.35),
        ),
      LiminalBadgeTone.success => (
          lim.success.withValues(alpha: 0.12),
          lim.success,
          lim.success.withValues(alpha: 0.35),
        ),
      LiminalBadgeTone.warn => (
          lim.warn.withValues(alpha: 0.12),
          lim.warn,
          lim.warn.withValues(alpha: 0.35),
        ),
      LiminalBadgeTone.danger => (
          lim.danger.withValues(alpha: 0.12),
          lim.danger,
          lim.danger.withValues(alpha: 0.35),
        ),
      LiminalBadgeTone.neutral => (
          lim.panel,
          lim.textDim,
          lim.border,
        ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[
            Icon(icon, size: 12, color: fg),
            const SizedBox(width: 4),
          ],
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(color: fg),
          ),
        ],
      ),
    );
  }
}
