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
          Color.lerp(lim.accent, Colors.white, 0.25)!,
          lim.accent.withValues(alpha: 0.28),
        ),
      LiminalBadgeTone.success => (
          lim.success.withValues(alpha: 0.12),
          Color.lerp(lim.success, Colors.white, 0.25)!,
          lim.success.withValues(alpha: 0.28),
        ),
      LiminalBadgeTone.warn => (
          lim.warn.withValues(alpha: 0.12),
          Color.lerp(lim.warn, Colors.white, 0.25)!,
          lim.warn.withValues(alpha: 0.28),
        ),
      LiminalBadgeTone.danger => (
          lim.danger.withValues(alpha: 0.12),
          Color.lerp(lim.danger, Colors.white, 0.25)!,
          lim.danger.withValues(alpha: 0.28),
        ),
      LiminalBadgeTone.neutral => (
          Colors.white.withValues(alpha: 0.05),
          lim.textMuted,
          lim.border,
        ),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
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
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: fg,
                  fontSize: 11,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.2,
                ),
          ),
        ],
      ),
    );
  }
}
