import 'package:flutter/material.dart';

import '../../theme/liminal_theme_extension.dart';
import '../tokens/liminal_elevation.dart';
import '../tokens/liminal_motion.dart';

/// Standard bordered surface used across cards, sections, and tiles.
///
/// Tappable surfaces get a desktop hover treatment for free: the fill lifts
/// one step and the hairline border brightens.
class LiminalSurface extends StatefulWidget {
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
  State<LiminalSurface> createState() => _LiminalSurfaceState();
}

class _LiminalSurfaceState extends State<LiminalSurface> {
  bool _hovered = false;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final r = widget.radius ?? lim.radius;
    final interactive = widget.onTap != null;
    final raise = interactive && _hovered;

    // A whisper of white over the surface separates cards from the backdrop
    // without relying on glowing borders.
    final restingBg = widget.color ??
        Color.alphaBlend(Colors.white.withValues(alpha: 0.025), lim.surface)
            .withValues(alpha: 0.85);
    final bg = raise
        ? Color.alphaBlend(Colors.white.withValues(alpha: 0.035), restingBg)
        : restingBg;
    final border = raise ? lim.borderStrong : (widget.borderColor ?? lim.border);

    Widget content = AnimatedContainer(
      duration: LiminalMotion.fast,
      curve: LiminalMotion.standard,
      padding: widget.padding,
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(r),
        border: Border.all(color: border),
        boxShadow: widget.elevation > 0
            ? LiminalElevation.shadow(lim.accent, level: widget.elevation, glow: lim.glow)
            : null,
      ),
      child: widget.child,
    );

    if (interactive) {
      content = MouseRegion(
        onEnter: (_) => setState(() => _hovered = true),
        onExit: (_) => setState(() => _hovered = false),
        cursor: SystemMouseCursors.click,
        child: Material(
          color: Colors.transparent,
          child: InkWell(
            onTap: widget.onTap,
            borderRadius: BorderRadius.circular(r),
            splashColor: Colors.transparent,
            highlightColor: lim.pressedOverlay,
            hoverColor: Colors.transparent,
            child: content,
          ),
        ),
      );
    }
    return content;
  }
}
