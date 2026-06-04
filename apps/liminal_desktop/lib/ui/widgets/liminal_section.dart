import 'package:flutter/material.dart';

import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import 'liminal_page_canvas.dart';

/// Titled block with optional description — content sits in a bordered card.
class LiminalSection extends StatelessWidget {
  const LiminalSection({
    super.key,
    required this.title,
    required this.child,
    this.subtitle,
    this.trailing,
  });

  final String title;
  final String? subtitle;
  final Widget child;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: lim.accent,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                  if (subtitle != null && subtitle!.isNotEmpty) ...[
                    const SizedBox(height: LiminalSpacing.xxs),
                    Text(
                      subtitle!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: lim.textMuted,
                            height: 1.35,
                          ),
                    ),
                  ],
                ],
              ),
            ),
            if (trailing != null) trailing!,
          ],
        ),
        const SizedBox(height: LiminalSpacing.sm),
        DecoratedBox(
          decoration: BoxDecoration(
            color: lim.surface.withValues(alpha: 0.72),
            borderRadius: BorderRadius.circular(lim.radius),
            border: Border.all(color: lim.border),
          ),
          child: Padding(
            padding: const EdgeInsets.all(LiminalSpacing.md),
            child: child,
          ),
        ),
      ],
    );
  }
}

/// Legacy alias — prefer [LiminalPageCanvas] for full-width responsive layouts.
class LiminalContentWidth extends StatelessWidget {
  const LiminalContentWidth({
    super.key,
    required this.child,
    this.maxWidth,
  });

  final Widget child;
  final double? maxWidth;

  @override
  Widget build(BuildContext context) {
    return LiminalPageCanvas(child: child);
  }
}
