import 'package:flutter/material.dart';

import '../../layout/liminal_spacing.dart';
import '../../theme/liminal_theme_extension.dart';
import '../primitives/liminal_button.dart';
import '../tokens/liminal_typography.dart';

/// Bottom action sheet for approvals, ask-user, and confirmations.
class LiminalSheet extends StatelessWidget {
  const LiminalSheet({
    super.key,
    required this.title,
    required this.body,
    this.leading,
    this.accentColor,
    this.primaryLabel = 'Confirm',
    this.secondaryLabel = 'Cancel',
    this.onPrimary,
    this.onSecondary,
    this.footer,
    this.borderWidth = 2,
  });

  final String title;
  final Widget body;
  final Widget? leading;
  final Color? accentColor;
  final String primaryLabel;
  final String secondaryLabel;
  final VoidCallback? onPrimary;
  final VoidCallback? onSecondary;
  final Widget? footer;
  final double borderWidth;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final accent = accentColor ?? lim.warn;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(LiminalSpacing.md),
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.98),
        border: Border(
          top: BorderSide(color: accent.withValues(alpha: 0.6), width: borderWidth),
        ),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              if (leading != null) ...[
                leading!,
                const SizedBox(width: LiminalSpacing.xs),
              ],
              Expanded(
                child: Text(
                  title,
                  style: LiminalTypography.sectionTitle(context).copyWith(color: accent),
                ),
              ),
            ],
          ),
          const SizedBox(height: LiminalSpacing.sm),
          body,
          if (footer != null) ...[
            const SizedBox(height: LiminalSpacing.sm),
            footer!,
          ] else if (onPrimary != null || onSecondary != null) ...[
            const SizedBox(height: LiminalSpacing.md),
            Row(
              children: [
                if (onSecondary != null)
                  Expanded(
                    child: LiminalButton(
                      label: secondaryLabel,
                      variant: LiminalButtonVariant.ghost,
                      onPressed: onSecondary,
                    ),
                  ),
                if (onSecondary != null && onPrimary != null)
                  const SizedBox(width: LiminalSpacing.sm),
                if (onPrimary != null)
                  Expanded(
                    child: LiminalButton(
                      label: primaryLabel,
                      variant: LiminalButtonVariant.primary,
                      onPressed: onPrimary,
                    ),
                  ),
              ],
            ),
          ],
        ],
      ),
    );
  }
}
