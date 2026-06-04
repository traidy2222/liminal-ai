import 'package:flutter/material.dart';

import '../../core/tool_args_format.dart';
import '../../state/message_models.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

/// Compact tool row — distinct from chat bubbles (web compact `ToolCard`).
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
    final borderColor = _statusColor(lim, status);
    final argHint = formatToolPrimaryArg(m.argsPreview);
    final showArg = argHint.isNotEmpty;
    final output = m.output?.trim() ?? '';
    final isError = status == ToolCallStatus.error;
    final showErrorSnippet = isError && output.isNotEmpty && !widget.verbose;
    final showOkSnippet = !isError &&
        !widget.verbose &&
        status == ToolCallStatus.done &&
        output.isNotEmpty;
    final canExpand = widget.verbose ||
        (!isTrivialToolArgs(m.argsPreview) && m.argsPreview.trim().isNotEmpty) ||
        (output.isNotEmpty && output.length > 120);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 2),
      child: Material(
        color: lim.surface.withValues(alpha: 0.72),
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: canExpand ? () => setState(() => _expanded = !_expanded) : null,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            decoration: BoxDecoration(
              borderRadius: BorderRadius.circular(6),
              border: Border.all(color: lim.border.withValues(alpha: 0.65)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: 3,
                  constraints: const BoxConstraints(minHeight: 34),
                  decoration: BoxDecoration(
                    color: borderColor,
                    borderRadius: const BorderRadius.horizontal(
                      left: Radius.circular(6),
                    ),
                  ),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(10, 6, 10, 6),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Row(
                          children: [
                            Icon(
                              _statusIcon(status),
                              size: 14,
                              color: borderColor,
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: Text(
                                m.name,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: LiminalTheme.mono(
                                  context,
                                  fontSize: 12,
                                  fontWeight: FontWeight.w600,
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
                                  style: LiminalTheme.mono(
                                    context,
                                    fontSize: 10,
                                    color: lim.textDim,
                                  ),
                                ),
                              ),
                            ],
                            const SizedBox(width: 8),
                            _StatusChip(status: status, color: borderColor),
                            if (canExpand)
                              Padding(
                                padding: const EdgeInsets.only(left: 4),
                                child: Icon(
                                  _expanded
                                      ? Icons.expand_less
                                      : Icons.expand_more,
                                  size: 16,
                                  color: lim.textDim,
                                ),
                              ),
                          ],
                        ),
                        if (showErrorSnippet || showOkSnippet)
                          Padding(
                            padding: const EdgeInsets.only(top: 4, left: 22),
                            child: Text(
                              output.length > 160
                                  ? '${output.substring(0, 159)}…'
                                  : output,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: LiminalTheme.mono(
                                context,
                                fontSize: 10,
                                color: isError
                                    ? lim.danger.withValues(alpha: 0.9)
                                    : lim.textMuted,
                              ),
                            ),
                          ),
                        if (_expanded || widget.verbose) ...[
                          if (!isTrivialToolArgs(m.argsPreview) &&
                              m.argsPreview.trim().isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Text(
                              m.argsPreview,
                              maxLines: widget.verbose ? 24 : 8,
                              overflow: TextOverflow.ellipsis,
                              style: LiminalTheme.mono(
                                context,
                                fontSize: 10,
                                color: lim.textDim,
                              ).copyWith(height: 1.35),
                            ),
                          ],
                          if (output.isNotEmpty) ...[
                            const SizedBox(height: 6),
                            Text(
                              output,
                              maxLines: widget.verbose ? 32 : 12,
                              overflow: TextOverflow.ellipsis,
                              style: LiminalTheme.mono(
                                context,
                                fontSize: 10,
                                color: isError ? lim.danger : lim.textMuted,
                              ).copyWith(height: 1.35),
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
    );
  }

  static Color _statusColor(LiminalTokens lim, ToolCallStatus s) =>
      switch (s) {
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

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status, required this.color});

  final ToolCallStatus status;
  final Color color;

  @override
  Widget build(BuildContext context) {
    final label = switch (status) {
      ToolCallStatus.streaming => '…',
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
