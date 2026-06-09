import 'package:flutter/material.dart';

import '../../theme/liminal_theme_extension.dart';
import '../tokens/liminal_elevation.dart';
import '../tokens/liminal_motion.dart';

/// Standard bordered surface used across cards, sections, and tiles.
class LiminalSurface extends StatelessWidget {
  const LiminalSurface({
    super.key,
    required this.child,
    this.padding,
    this.radius,
    this.color,
    this.borderColor,
    this.elevation = LiminalElevation.none,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry? padding;
  final double? radius;
  final Color? color;
  final Color? borderColor;
  final double elevation;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final r = radius ?? lim.radius;
    final bg = color ?? lim.surface.withValues(alpha: 0.72);
    final border = borderColor ?? lim.border;

    Widget content = AnimatedContainer(
      duration: LiminalMotion.normal,
      padding: padding,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(r),
        border: Border.all(color: border),
        boxShadow: elevation > 0 ? LiminalElevation.shadow(lim.accent, level: elevation, glow: lim.glow) : null,
      ),
      child: child,
    );

    if (onTap != null) {
      content = Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(r),
          child: content,
        ),
      );
    }
    return content;
  }
}
