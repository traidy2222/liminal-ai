import 'package:flutter/material.dart';

import '../../layout/liminal_spacing.dart';
import '../../theme/liminal_theme_extension.dart';
import '../primitives/liminal_button.dart';
import '../tokens/liminal_typography.dart';

/// Centered empty / onboarding placeholder.
class LiminalEmptyState extends StatelessWidget {
  const LiminalEmptyState({
    super.key,
    required this.title,
    this.body,
    this.icon,
    this.actionLabel,
    this.onAction,
    this.compact = false,
  });

  final String title;
  final String? body;
  final IconData? icon;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Center(
      child: Padding(
        padding: EdgeInsets.symmetric(
          horizontal: compact ? 16 : 24,
          vertical: compact ? 8 : 24,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[
              Icon(icon, size: compact ? 32 : 40, color: lim.textDim),
              const SizedBox(height: LiminalSpacing.sm),
            ],
            Text(
              title,
              textAlign: TextAlign.center,
              style: compact
                  ? Theme.of(context).textTheme.titleLarge?.copyWith(color: lim.text)
                  : LiminalTypography.pageTitle(context),
            ),
            if (body != null && body!.isNotEmpty) ...[
              const SizedBox(height: LiminalSpacing.xs),
              Text(
                body!,
                textAlign: TextAlign.center,
                style: LiminalTypography.body(context),
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: LiminalSpacing.md),
              LiminalButton.icon(
                label: actionLabel!,
                icon: Icons.add,
                variant: LiminalButtonVariant.secondary,
                onPressed: onAction,
              ),
            ],
          ],
        ),
      ),
    );
  }
}
