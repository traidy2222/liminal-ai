import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../theme/liminal_theme_extension.dart';
import '../tokens/liminal_motion.dart';

/// Desktop hover + keyboard focus ring for clickable surfaces.
class LiminalInteractive extends StatefulWidget {
  const LiminalInteractive({
    super.key,
    required this.builder,
    this.onPressed,
    this.borderRadius,
    this.enabled = true,
    this.semanticLabel,
  });

  final Widget Function(BuildContext context, bool hovered, bool focused) builder;
  final VoidCallback? onPressed;
  final BorderRadius? borderRadius;
  final bool enabled;
  final String? semanticLabel;

  @override
  State<LiminalInteractive> createState() => _LiminalInteractiveState();
}

class _LiminalInteractiveState extends State<LiminalInteractive> {
  bool _hovered = false;
  bool _focused = false;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final radius = widget.borderRadius ?? BorderRadius.circular(lim.radius);
    final canPress = widget.enabled && widget.onPressed != null;

    return FocusableActionDetector(
      enabled: canPress,
      onShowFocusHighlight: (v) => setState(() => _focused = v),
      shortcuts: const {
        SingleActivator(LogicalKeyboardKey.enter): ActivateIntent(),
        SingleActivator(LogicalKeyboardKey.space): ActivateIntent(),
      },
      actions: {
        ActivateIntent: CallbackAction<ActivateIntent>(
          onInvoke: (_) {
            widget.onPressed?.call();
            return null;
          },
        ),
      },
      child: Semantics(
        button: canPress,
        label: widget.semanticLabel,
        enabled: canPress,
        child: MouseRegion(
          onEnter: canPress ? (_) => setState(() => _hovered = true) : null,
          onExit: canPress ? (_) => setState(() => _hovered = false) : null,
          cursor: canPress ? SystemMouseCursors.click : SystemMouseCursors.basic,
          child: AnimatedContainer(
            duration: LiminalMotion.fast,
            decoration: BoxDecoration(
              borderRadius: radius,
              border: _focused
                  ? Border.all(color: lim.accent.withValues(alpha: 0.65), width: 1.5)
                  : null,
            ),
            child: Material(
              color: _hovered && canPress
                  ? lim.accent.withValues(alpha: 0.06)
                  : Colors.transparent,
              borderRadius: radius,
              child: InkWell(
                onTap: canPress ? widget.onPressed : null,
                borderRadius: radius,
                splashColor: lim.accent.withValues(alpha: 0.12),
                highlightColor: lim.accent.withValues(alpha: 0.08),
                child: widget.builder(context, _hovered, _focused),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
