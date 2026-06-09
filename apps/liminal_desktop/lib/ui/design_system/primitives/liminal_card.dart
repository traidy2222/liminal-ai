import 'package:flutter/material.dart';

import '../../layout/liminal_spacing.dart';
import 'liminal_surface.dart';

/// Bordered content card — building block for sections and hub tiles.
class LiminalCard extends StatelessWidget {
  const LiminalCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(LiminalSpacing.md),
    this.onTap,
    this.elevation = 0,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final double elevation;

  @override
  Widget build(BuildContext context) {
    return LiminalSurface(
      padding: padding,
      elevation: elevation,
      onTap: onTap,
      child: child,
    );
  }
}
