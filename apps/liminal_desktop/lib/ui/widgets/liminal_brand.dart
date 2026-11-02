import 'package:flutter/material.dart';
import '../theme/liminal_theme_extension.dart';

/// Two offset thresholds, shared with the web wordmark.
class LiminalThresholdMark extends StatelessWidget {
  const LiminalThresholdMark({super.key, this.size = 36});
  final double size;
  @override
  Widget build(BuildContext context) => ExcludeSemantics(
        child: CustomPaint(
          size: Size(size, size * 1.1),
          painter: _ThresholdPainter(LiminalTheme.of(context).accent),
        ),
      );
}

class _ThresholdPainter extends CustomPainter {
  const _ThresholdPainter(this.color);
  final Color color;
  @override
  void paint(Canvas canvas, Size size) {
    canvas.save();
    canvas.scale(size.width / 40, size.height / 44);
    final paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2.5
      ..strokeJoin = StrokeJoin.round;
    canvas.drawPath(
      Path()
        ..moveTo(6, 37)
        ..lineTo(6, 7)
        ..lineTo(29, 7)
        ..lineTo(29, 37),
      paint,
    );
    canvas.drawPath(
      Path()
        ..moveTo(15, 37)
        ..lineTo(15, 16)
        ..lineTo(34, 16)
        ..lineTo(34, 37)
        ..lineTo(6, 37),
      paint,
    );
    canvas.restore();
  }

  @override
  bool shouldRepaint(_ThresholdPainter oldDelegate) =>
      color != oldDelegate.color;
}

class LiminalBrandMark extends StatelessWidget {
  const LiminalBrandMark({super.key, this.subtitle, this.compact = false});
  final String? subtitle;
  final bool compact;
  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        LiminalThresholdMark(size: compact ? 30 : 40),
        const SizedBox(width: 12),
        Flexible(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                lim.displayLabel,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontFamily: lim.fontFamilyHeading,
                  fontSize: compact ? 24 : 32,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -1,
                  color: lim.text,
                ),
              ),
              if (subtitle != null && subtitle!.isNotEmpty) ...[
                const SizedBox(height: 3),
                Text(
                  subtitle!,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(fontSize: 11, color: lim.textMuted),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
