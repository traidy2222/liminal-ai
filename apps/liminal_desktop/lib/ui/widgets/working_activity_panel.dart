import 'package:flutter/material.dart';

import '../../core/transcript_grouping.dart';
import '../../state/message_models.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import 'message_tile.dart';

/// Collapsible container for a run of tool / reasoning activity in the transcript.
class WorkingActivityPanel extends StatefulWidget {
  const WorkingActivityPanel({
    super.key,
    required this.entries,
    required this.verboseTools,
    required this.personaLabel,
    this.startExpanded = false,
  });

  final List<MessageEntry> entries;
  final bool verboseTools;
  final String personaLabel;
  final bool startExpanded;

  @override
  State<WorkingActivityPanel> createState() => _WorkingActivityPanelState();
}

class _WorkingActivityPanelState extends State<WorkingActivityPanel> {
  final _tileController = ExpansionTileController();

  @override
  void didUpdateWidget(covariant WorkingActivityPanel oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.startExpanded && !oldWidget.startExpanded) {
      _tileController.expand();
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final summary = summarizeActivityGroup(widget.entries);
    final subtitle = activityGroupSubtitle(summary);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: lim.border),
        child: ExpansionTile(
          controller: _tileController,
          initiallyExpanded: widget.startExpanded,
          tilePadding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
          childrenPadding: const EdgeInsets.fromLTRB(4, 0, 4, 8),
          backgroundColor: lim.surface.withValues(alpha: 0.35),
          collapsedBackgroundColor: lim.surface.withValues(alpha: 0.22),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(lim.radius * 0.55),
            side: BorderSide(
              color: summary.isActive
                  ? lim.accent.withValues(alpha: 0.4)
                  : lim.border.withValues(alpha: 0.55),
            ),
          ),
          collapsedShape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(lim.radius * 0.55),
            side: BorderSide(
              color: summary.isActive
                  ? lim.accent.withValues(alpha: 0.35)
                  : lim.border.withValues(alpha: 0.45),
            ),
          ),
          leading: summary.isActive
              ? SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(
                    strokeWidth: 2,
                    color: lim.accent,
                  ),
                )
              : Icon(
                  summary.errorCount > 0
                      ? Icons.error_outline
                      : Icons.check_circle_outline,
                  size: 16,
                  color: summary.errorCount > 0 ? lim.danger : lim.textDim,
                ),
          title: Text(
            'Working',
            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  color: lim.text,
                  fontWeight: FontWeight.w600,
                ),
          ),
          subtitle: Text(
            subtitle,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: lim.textMuted,
                  height: 1.25,
                ),
          ),
          children: [
            for (final entry in widget.entries)
              Padding(
                padding: const EdgeInsets.only(bottom: LiminalSpacing.xxs),
                child: MessageTile(
                  entry: entry,
                  verboseTools: widget.verboseTools,
                  personaLabel: widget.personaLabel,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
