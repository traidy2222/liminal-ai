import 'package:flutter/material.dart';

import '../theme/liminal_theme_extension.dart';

/// HUD grid + top glow (web `backgroundLayers` for hud/grid shell).
class LiminalBackground extends StatelessWidget {
  const LiminalBackground({super.key, required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalThemeExtension.of(context).tokens;
    return Stack(
      fit: StackFit.expand,
      children: [
        DecoratedBox(
          decoration: BoxDecoration(
            gradient: LinearGradient(
              begin: Alignment.topCenter,
              end: Alignment.bottomCenter,
              colors: [lim.surface, lim.background],
            ),
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
                lim.accent.withValues(alpha: 0.14),
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
