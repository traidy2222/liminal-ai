import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../theme/liminal_theme_extension.dart';

enum PanelResizeAxis { horizontal, vertical }

/// Drag handle for resizing adjacent panels (terminal height or dock rail width).
class PanelResizeHandle extends StatelessWidget {
  const PanelResizeHandle({
    super.key,
    required this.axis,
    required this.onDragDelta,
    this.thickness = 8,
  });

  final PanelResizeAxis axis;
  /// Positive delta grows the panel being resized (taller terminal / wider rail).
  final ValueChanged<double> onDragDelta;
  final double thickness;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final vertical = axis == PanelResizeAxis.vertical;

    return MouseRegion(
      cursor: vertical ? SystemMouseCursors.resizeRow : SystemMouseCursors.resizeColumn,
      child: GestureDetector(
        behavior: HitTestBehavior.opaque,
        onVerticalDragUpdate: vertical
            ? (details) => onDragDelta(-details.delta.dy)
            : null,
        onHorizontalDragUpdate: vertical
            ? null
            : (details) => onDragDelta(details.delta.dx),
        child: SizedBox(
          width: vertical ? double.infinity : thickness,
          height: vertical ? thickness : double.infinity,
          child: Center(
            child: Container(
              width: vertical ? 56 : 3,
              height: vertical ? 3 : 56,
              decoration: BoxDecoration(
                color: lim.accent.withValues(alpha: 0.4),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
