import 'package:flutter/material.dart';

import '../../theme/liminal_theme_extension.dart';
import 'liminal_interactive.dart';

/// Toolbar / header icon control with hover + focus.
class LiminalIconButton extends StatelessWidget {
  const LiminalIconButton({
    super.key,
    required this.icon,
    required this.tooltip,
    this.onPressed,
    this.selected = false,
    this.size = 20,
  });

  final IconData icon;
  final String tooltip;
  final VoidCallback? onPressed;
  final bool selected;
  final double size;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Tooltip(
      message: tooltip,
      child: LiminalInteractive(
        onPressed: onPressed,
        borderRadius: BorderRadius.circular(lim.radius),
        semanticLabel: tooltip,
        builder: (context, hovered, focused) {
          final color = selected
              ? lim.accent
              : (hovered || focused ? lim.text : lim.textMuted);
          return Padding(
            padding: const EdgeInsets.all(8),
            child: Icon(icon, size: size, color: color),
          );
        },
      ),
    );
  }
}
