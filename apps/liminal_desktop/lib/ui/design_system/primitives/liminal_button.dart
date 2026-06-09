import 'package:flutter/material.dart';

import '../../layout/liminal_spacing.dart';
import '../../theme/liminal_theme_extension.dart';

enum LiminalButtonVariant { primary, secondary, ghost, danger }

/// Token-aware button — prefer over raw Material buttons in app chrome.
class LiminalButton extends StatelessWidget {
  const LiminalButton({
    super.key,
    required this.label,
    this.onPressed,
    this.icon,
    this.variant = LiminalButtonVariant.primary,
    this.dense = false,
  });

  const LiminalButton.icon({
    super.key,
    required this.label,
    required this.icon,
    this.onPressed,
    this.variant = LiminalButtonVariant.primary,
    this.dense = false,
  });

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final LiminalButtonVariant variant;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final child = icon != null
        ? Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icon, size: dense ? 16 : 18),
              const SizedBox(width: LiminalSpacing.xs),
              Text(label),
            ],
          )
        : Text(label);

    switch (variant) {
      case LiminalButtonVariant.primary:
        return FilledButton(
          onPressed: onPressed,
          style: _denseStyle(context, dense),
          child: child,
        );
      case LiminalButtonVariant.secondary:
        return OutlinedButton(
          onPressed: onPressed,
          style: _denseStyle(context, dense),
          child: child,
        );
      case LiminalButtonVariant.ghost:
        return TextButton(
          onPressed: onPressed,
          style: _denseStyle(context, dense),
          child: child,
        );
      case LiminalButtonVariant.danger:
        final lim = LiminalTheme.of(context);
        return FilledButton(
          onPressed: onPressed,
          style: FilledButton.styleFrom(
            backgroundColor: lim.danger.withValues(alpha: 0.14),
            foregroundColor: lim.danger,
            side: BorderSide(color: lim.danger.withValues(alpha: 0.35)),
          ).merge(_denseStyle(context, dense)),
          child: child,
        );
    }
  }

  ButtonStyle? _denseStyle(BuildContext context, bool dense) {
    if (!dense) return null;
    return ButtonStyle(
      padding: const WidgetStatePropertyAll(
        EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      ),
      visualDensity: VisualDensity.compact,
    );
  }
}
