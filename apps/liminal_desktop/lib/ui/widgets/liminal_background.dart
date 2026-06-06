import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../models/persona_ui_theme.dart';
import '../theme/liminal_theme_extension.dart';

/// HUD grid + top glow (web `backgroundLayers` for hud/grid shell).
class LiminalBackground extends StatelessWidget {
  const LiminalBackground({super.key, required this.child});

  final Widget child;

  /// Build the base fill: a persona-authored structured gradient when present,
  /// else the default surface→background vertical wash.
  Gradient _baseGradient(PersonaGradient? g, Color surface, Color background) {
    if (g == null || g.stops.length < 2) {
      return LinearGradient(
        begin: Alignment.topCenter,
        end: Alignment.bottomCenter,
        colors: [surface, background],
      );
    }
    if (g.kind == 'radial') {
      return RadialGradient(
        center: const Alignment(0, -0.6),
        radius: 1.2,
        colors: g.colors,
        stops: g.positions,
      );
    }
    final rad = ((g.angle ?? 135) - 90) * math.pi / 180.0;
    final dx = math.cos(rad);
    final dy = math.sin(rad);
    return LinearGradient(
      begin: Alignment(-dx, -dy),
      end: Alignment(dx, dy),
      colors: g.colors,
      stops: g.positions,
    );
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalThemeExtension.of(context).tokens;
    return Stack(
      fit: StackFit.expand,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: _baseGradient(lim.gradient, lim.surface, lim.background),
          ),
        ),
        if (lim.showGrid)
          CustomPaint(
            painter: _GridPainter(accent: lim.accent),
          ),
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: RadialGradient(
              center: const Alignment(0, -0.85),
              radius: 1.1,
              colors: [
                lim.accent.withValues(alpha: (0.14 * (lim.glow / 0.35)).clamp(0.0, 0.4).toDouble()),
                Colors.transparent,
              ],
            ),
          ),
        ),
        child,
      ],
    );
  }
}

class _GridPainter extends CustomPainter {
  _GridPainter({required this.accent});

  final Color accent;
  static const _step = 44.0;

  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = accent.withValues(alpha: 0.045)
      ..strokeWidth = 1;
    for (var x = 0.0; x < size.width; x += _step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (var y = 0.0; y < size.height; y += _step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  @override
  bool shouldRepaint(covariant _GridPainter old) => old.accent != accent;
}
