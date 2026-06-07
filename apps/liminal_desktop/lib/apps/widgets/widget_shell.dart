import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

/// Frameless desktop widget chrome: drag header, refresh, hide.
class WidgetShell extends StatelessWidget {
  const WidgetShell({
    super.key,
    required this.title,
    required this.accent,
    required this.child,
    this.onRefresh,
    this.onHide,
  });

  final String title;
  final Color accent;
  final Widget child;
  final VoidCallback? onRefresh;
  final VoidCallback? onHide;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: DecoratedBox(
          decoration: BoxDecoration(
            color: const Color(0xFF121820),
            borderRadius: BorderRadius.circular(14),
            border: Border.all(color: accent.withValues(alpha: 0.35)),
            boxShadow: const [
              BoxShadow(
                color: Color(0x66000000),
                blurRadius: 20,
                offset: Offset(0, 6),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                DragToMoveArea(
                  child: Container(
                    height: 34,
                    padding: const EdgeInsets.symmetric(horizontal: 10),
                    decoration: BoxDecoration(
                      color: accent.withValues(alpha: 0.12),
                      border: Border(
                        bottom: BorderSide(color: accent.withValues(alpha: 0.2)),
                      ),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.widgets_outlined, size: 14, color: accent),
                        const SizedBox(width: 6),
                        Expanded(
                          child: Text(
                            title,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: Theme.of(context).textTheme.labelLarge?.copyWith(
                                  color: Colors.white.withValues(alpha: 0.92),
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                        ),
                        if (onRefresh != null)
                          IconButton(
                            visualDensity: VisualDensity.compact,
                            padding: EdgeInsets.zero,
                            constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                            tooltip: 'Refresh',
                            onPressed: onRefresh,
                            icon: Icon(Icons.refresh, size: 16, color: accent),
                          ),
                        IconButton(
                          visualDensity: VisualDensity.compact,
                          padding: EdgeInsets.zero,
                          constraints: const BoxConstraints(minWidth: 28, minHeight: 28),
                          tooltip: 'Hide widget',
                          onPressed: onHide,
                          icon: Icon(
                            Icons.minimize,
                            size: 16,
                            color: Colors.white.withValues(alpha: 0.7),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
                Expanded(child: child),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
