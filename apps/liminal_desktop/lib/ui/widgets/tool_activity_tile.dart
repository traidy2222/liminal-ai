import 'package:flutter/material.dart';

import '../../core/tool_args_format.dart';
import '../../state/message_models.dart';
import '../chat/tool_category.dart';
import '../design_system/primitives/liminal_badge.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

/// Compact tool row in the activity lane — distinct from conversation bubbles.
class ToolActivityTile extends StatefulWidget {
  const ToolActivityTile({
    super.key,
    required this.message,
    this.verbose = false,
  });

  final ToolCallMessage message;
  final bool verbose;

  @override
  State<ToolActivityTile> createState() => _ToolActivityTileState();
}

class _ToolActivityTileState extends State<ToolActivityTile> {
  bool _expanded = false;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final m = widget.message;
    final status = m.status;
    final cat = toolCategoryFor(m.name);
    final catColor = toolCategoryColor(cat, lim);
    final statusColor = _statusColor(lim, status);
    final borderColor = status == ToolCallStatus.done || status == ToolCallStatus.error
        ? statusColor
        : catColor;
    final argHint = formatToolPrimaryArg(m.argsPreview);
    final showArg = argHint.isNotEmpty;
    final output = m.output?.trim() ?? '';
    final isError = status == ToolCallStatus.error;
    final isActive = status == ToolCallStatus.streaming ||
        status == ToolCallStatus.running ||
        status == ToolCallStatus.pendingApproval;
    final showErrorSnippet = isError && output.isNotEmpty && !widget.verbose;
    final showOkSnippet = !isError &&
        !widget.verbose &&
        status == ToolCallStatus.done &&
        output.isNotEmpty;
    final canExpand = widget.verbose ||
        (!isTrivialToolArgs(m.argsPreview) && m.argsPreview.trim().isNotEmpty) ||
        (output.isNotEmpty && output.length > 120);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Material(
        color: lim.panel.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(lim.radius * 0.45),
        child: InkWell(
          onTap: canExpand ? () => setState(() => _expanded = !_expanded) : null,
          borderRadius: BorderRadius.circular(lim.radius * 0.45),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(lim.radius * 0.45),
              border: Border.all(color: lim.border.withValues(alpha: 0.55)),
            ),
            child: IntrinsicHeight(
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Container(
                    width: 3,
                    decoration: BoxDecoration(
                      color: borderColor,
                      borderRadius: BorderRadius.horizontal(
                        left: Radius.circular(lim.radius * 0.45),
                      ),
                    ),
                  ),
                  Expanded(
                    child: Padding(
                      padding: const EdgeInsets.fromLTRB(10, 7, 10, 7),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Icon(toolCategoryIcon(cat), size: 15, color: catColor),
                              const SizedBox(width: 6),
                              Icon(_statusIcon(status), size: 13, color: statusColor),
                              const SizedBox(width: 6),
                              Expanded(
                                child: Text(
                                  m.name,
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: LiminalTheme.mono(
                                    context,
                                    fontSize: 12,
                                    fontWeight: FontWeight.w700,
                                    color: lim.text,
                                  ),
                                ),
                              ),
                              if (showArg) ...[
                                const SizedBox(width: 8),
                                Flexible(
                                  flex: 2,
                                  child: Text(
                                    argHint,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                    textAlign: TextAlign.end,
                                    style: LiminalTheme.mono(
                                      context,
                                      fontSize: 10,
                                      color: lim.textDim,
                                    ),
                                  ),
                                ),
                              ],
                              const SizedBox(width: 6),
                              _StatusChip(status: status, color: statusColor),
                              if (canExpand)
                                Padding(
                                  padding: const EdgeInsets.only(left: 2),
                                  child: Icon(
                                    _expanded ? Icons.expand_less : Icons.expand_more,
                                    size: 16,
                                    color: lim.textDim,
                                  ),
                                ),
                            ],
                          ),
                          if (isActive && output.isEmpty && !showArg)
                            Padding(
                              padding: const EdgeInsets.only(top: 4, left: 34),
                              child: Text(
                                _activeLabel(status),
                                style: LiminalTheme.mono(
                                  context,
                                  fontSize: 10,
                                  color: lim.textDim,
                                ).copyWith(fontStyle: FontStyle.italic),
                              ),
                            ),
                          if (showErrorSnippet || showOkSnippet)
                            Padding(
                              padding: const EdgeInsets.only(top: 5, left: 34),
                              child: Container(
                                width: double.infinity,
                                padding: const EdgeInsets.symmetric(
                                  horizontal: LiminalSpacing.xs,
                                  vertical: 5,
                                ),
                                decoration: BoxDecoration(
                                  color: lim.codeBackground.withValues(alpha: 0.65),
                                  borderRadius: BorderRadius.circular(4),
                                  border: Border.all(
                                    color: lim.border.withValues(alpha: 0.4),
                                  ),
                                ),
                                child: Text(
                                  output.length > 160
                                      ? '${output.substring(0, 159)}…'
                                      : output,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                  style: LiminalTheme.mono(
                                    context,
                                    fontSize: 10,
                                    color: isError ? lim.danger : lim.textMuted,
                                  ).copyWith(height: 1.4),
                                ),
                              ),
                            ),
                          if (_expanded || widget.verbose) ...[
                            if (!isTrivialToolArgs(m.argsPreview) &&
                                m.argsPreview.trim().isNotEmpty) ...[
                              const SizedBox(height: 6),
                              _CodeBlock(
                                lim: lim,
                                text: m.argsPreview,
                                maxLines: widget.verbose ? 24 : 8,
                                label: 'Arguments',
                              ),
                            ],
                            if (output.isNotEmpty) ...[
                              const SizedBox(height: 6),
                              _CodeBlock(
                                lim: lim,
                                text: output,
                                maxLines: widget.verbose ? 32 : 12,
                                label: 'Output',
                                error: isError,
                              ),
                            ],
                          ],
                        ],
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  static String _activeLabel(ToolCallStatus status) => switch (status) {
        ToolCallStatus.streaming => 'Streaming arguments…',
        ToolCallStatus.pendingApproval => 'Awaiting approval…',
        ToolCallStatus.running => 'Executing…',
        _ => '',
      };

  static Color _statusColor(LiminalTokens lim, ToolCallStatus s) => switch (s) {
        ToolCallStatus.done => lim.success,
        ToolCallStatus.error => lim.danger,
        ToolCallStatus.pendingApproval => lim.warn,
        ToolCallStatus.streaming || ToolCallStatus.running => lim.accent,
      };

  static IconData _statusIcon(ToolCallStatus s) => switch (s) {
        ToolCallStatus.pendingApproval => Icons.gavel_outlined,
        ToolCallStatus.error => Icons.close,
        ToolCallStatus.done => Icons.check,
        _ => Icons.play_arrow_outlined,
      };
}

class _CodeBlock extends StatelessWidget {
  const _CodeBlock({
    required this.lim,
    required this.text,
    required this.maxLines,
    required this.label,
    this.error = false,
  });

  final LiminalTokens lim;
  final String text;
  final int maxLines;
  final String label;
  final bool error;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        LiminalBadge(
          label: label,
          tone: LiminalBadgeTone.neutral,
        ),
        const SizedBox(height: 4),
        Container(
          width: double.infinity,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: lim.codeBackground.withValues(alpha: 0.8),
            borderRadius: BorderRadius.circular(4),
            border: Border.all(color: lim.border.withValues(alpha: 0.35)),
          ),
          child: SelectableText(
            text,
            maxLines: maxLines,
            style: LiminalTheme.mono(
              context,
              fontSize: 10,
              color: error ? lim.danger : lim.textMuted,
            ).copyWith(height: 1.4),
          ),
        ),
      ],
    );
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, required this.color});

  final ToolCallStatus status;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      ToolCallStatus.streaming => 'stream',
      ToolCallStatus.pendingApproval => 'approve',
      ToolCallStatus.running => 'run',
      ToolCallStatus.done => 'ok',
      ToolCallStatus.error => 'fail',
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Text(
        label,
        style: LiminalTheme.mono(
          context,
          fontSize: 9,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }
}
