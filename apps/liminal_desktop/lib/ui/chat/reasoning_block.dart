import 'package:flutter/material.dart';

import '../design_system/liminal_design_system.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

enum ReasoningKind { model, think, reason }

/// Collapsible cognition lane — distinct from user/assistant conversation.
class ReasoningBlock extends StatefulWidget {
  const ReasoningBlock({
    super.key,
    required this.kind,
    required this.title,
    required this.body,
    this.streaming = false,
    this.subtitle,
    this.startExpanded,
  });

  final ReasoningKind kind;
  final String title;
  final String body;
  final bool streaming;
  final String? subtitle;
  final bool? startExpanded;

  @override
  State<ReasoningBlock> createState() => _ReasoningBlockState();
}

class _ReasoningBlockState extends State<ReasoningBlock> {
  late bool _open;

  @override
  void initState() {
    super.initState();
    _open = widget.startExpanded ?? widget.streaming;
  }

  @override
  void didUpdateWidget(covariant ReasoningBlock oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.streaming && !oldWidget.streaming) {
      _open = true;
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final accent = _accentForKind(widget.kind, lim);
    final preview = widget.body.trim();
    final charCount = preview.length;

    if (!_open && !widget.streaming) {
      return LiminalInteractive(
        onPressed: () => setState(() => _open = true),
        borderRadius: BorderRadius.circular(lim.radius * 0.5),
        builder: (context, hovered, _) {
          return Container(
            width: double.infinity,
            padding: const EdgeInsets.symmetric(
              horizontal: LiminalSpacing.sm,
              vertical: LiminalSpacing.xs,
            ),
            decoration: BoxDecoration(
              color: lim.panel.withValues(alpha: hovered ? 0.55 : 0.4),
              borderRadius: BorderRadius.circular(lim.radius * 0.5),
              border: Border.all(color: hovered ? lim.borderStrong : lim.border),
            ),
            child: Row(
              children: [
                Icon(_iconForKind(widget.kind), size: 14, color: accent),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    '$charCount chars · tap to expand',
                    style: LiminalTypography.caption(context).copyWith(color: lim.textMuted),
                  ),
                ),
                Icon(Icons.unfold_more, size: 16, color: lim.textDim),
              ],
            ),
          );
        },
      );
    }

    return Container(
      width: double.infinity,
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(lim.radius * 0.55),
        border: Border.all(color: lim.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(10, 8, 6, 0),
            child: Row(
              children: [
                Icon(_iconForKind(widget.kind), size: 14, color: accent),
                const SizedBox(width: 6),
                Text(
                  widget.title.toUpperCase(),
                  style: LiminalTheme.mono(
                    context,
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    color: accent,
                  ).copyWith(letterSpacing: 0.08),
                ),
                if (widget.streaming) ...[
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 10,
                    height: 10,
                    child: CircularProgressIndicator(strokeWidth: 1.5, color: accent),
                  ),
                  const SizedBox(width: 4),
                  Text('LIVE', style: LiminalTheme.mono(context, fontSize: 9, color: accent)),
                ],
                const Spacer(),
                if (!widget.streaming)
                  LiminalIconButton(
                    icon: Icons.unfold_less,
                    tooltip: 'Collapse',
                    size: 16,
                    onPressed: () => setState(() => _open = false),
                  ),
              ],
            ),
          ),
          if (widget.subtitle != null && widget.subtitle!.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 4, 10, 0),
              child: Text(
                widget.subtitle!,
                style: LiminalTypography.caption(context),
              ),
            ),
          if (preview.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 6, 10, 10),
              child: SelectableText(
                preview,
                style: LiminalTheme.mono(
                  context,
                  fontSize: 12,
                  color: lim.textMuted,
                ).copyWith(
                  fontStyle: FontStyle.italic,
                  height: 1.55,
                ),
              ),
            ),
        ],
      ),
    );
  }

  static Color _accentForKind(ReasoningKind kind, LiminalTokens lim) => switch (kind) {
        ReasoningKind.model => lim.warn,
        ReasoningKind.think => lim.accent.withValues(alpha: 0.9),
        ReasoningKind.reason => lim.secondary,
      };

  static IconData _iconForKind(ReasoningKind kind) => switch (kind) {
        ReasoningKind.model => Icons.auto_awesome_outlined,
        ReasoningKind.think => Icons.psychology_outlined,
        ReasoningKind.reason => Icons.lightbulb_outline,
      };
}
