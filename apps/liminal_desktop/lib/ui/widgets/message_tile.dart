import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../rich_message/liminal_message_content.dart';
import '../theme/liminal_theme_extension.dart';
import 'tool_activity_tile.dart';

class MessageTile extends StatelessWidget {
  const MessageTile({
    super.key,
    required this.entry,
    this.verboseTools = false,
  });

  final MessageEntry entry;
  final bool verboseTools;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final lim = LiminalTheme.of(context);
    return switch (entry) {
      UserMessage(:final text, :final attachmentPreviews) => _bubble(
          context,
          alignment: Alignment.centerRight,
          color: lim.userBubble,
          border: Border.all(color: lim.accent.withValues(alpha: 0.35)),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (attachmentPreviews.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    children: [
                      for (final a in attachmentPreviews)
                        Chip(
                          label: Text(
                            a.name,
                            style: const TextStyle(fontSize: 11),
                          ),
                          visualDensity: VisualDensity.compact,
                        ),
                    ],
                  ),
                ),
              if (text.trim().isNotEmpty)
                Text(
                  text,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: lim.text,
                        height: 1.45,
                      ),
                ),
            ],
          ),
        ),
      AssistantMessage(:final text, :final streaming) => _bubble(
          context,
          alignment: Alignment.centerLeft,
          color: lim.surface.withValues(alpha: 0.75),
          border: Border.all(color: lim.border),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: LiminalMessageContent(text: text, streaming: streaming),
              ),
              if (streaming)
                const Padding(
                  padding: EdgeInsets.only(left: 8),
                  child: SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ),
            ],
          ),
        ),
      ModelReasoningMessage(:final text, :final streaming) => _reasoningCard(
          context,
          title: 'Reasoning',
          body: text,
          streaming: streaming,
        ),
      ThinkMessage(:final content, :final streaming, :final argsPreview) =>
        _reasoningCard(
          context,
          title: 'Think',
          body: content.isNotEmpty ? content : argsPreview,
          streaming: streaming,
        ),
      ReasonMessage(:final inference, :final streaming, :final argsPreview) =>
        _reasoningCard(
          context,
          title: 'Reason',
          body: inference.isNotEmpty ? inference : argsPreview,
          streaming: streaming,
        ),
      PlanMessage(:final steps, :final streaming) => Card(
          margin: const EdgeInsets.symmetric(vertical: 6),
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Text('Plan', style: theme.textTheme.titleSmall),
                    if (streaming) ...[
                      const SizedBox(width: 8),
                      const SizedBox(
                        width: 12,
                        height: 12,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      ),
                    ],
                  ],
                ),
                const SizedBox(height: 8),
                for (final s in steps)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text('• $s'),
                  ),
              ],
            ),
          ),
        ),
      TraceMessage(:final text) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Text(
            text,
            style: LiminalTheme.mono(
              context,
              fontSize: 11,
              color: lim.textDim,
            ).copyWith(height: 1.35),
          ),
        ),
      ToolCallMessage message => ToolActivityTile(
          message: message,
          verbose: verboseTools,
        ),
      ToolResultMessage(:final output, :final ok) => _bubble(
          context,
          alignment: Alignment.centerLeft,
          color: ok
              ? theme.colorScheme.tertiaryContainer.withValues(alpha: 0.4)
              : theme.colorScheme.errorContainer.withValues(alpha: 0.5),
          child: Text(
            output,
            maxLines: 16,
            overflow: TextOverflow.ellipsis,
            style: theme.textTheme.bodySmall?.copyWith(fontFamily: lim.fontFamilyMono),
          ),
        ),
      TurnHeaderMessage(
        :final intentClass,
        :final outcomeScore,
        :final toolCount,
        :final durationMs,
        :final keyTools,
        :final terminationReason,
      ) =>
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 6),
          child: Text(
            [
              intentClass,
              'outcome ${outcomeScore.toStringAsFixed(2)}',
              '$toolCount tools',
              '${(durationMs / 1000).round()}s',
              if (keyTools.isNotEmpty) keyTools.join(', '),
              if (terminationReason.isNotEmpty && terminationReason != 'ok')
                terminationReason,
            ].join(' · '),
            style: LiminalTheme.mono(context, fontSize: 11, color: lim.textDim),
          ),
        ),
      WorkingStateMessage(
        :final goal,
        :final driftScore,
        :final subgoalsPreview,
        :final executionPreview,
      ) =>
        _WorkingStatePanel(
          goal: goal,
          driftScore: driftScore,
          subgoalsPreview: subgoalsPreview,
          executionPreview: executionPreview,
        ),
      ContextCompressedMessage(:final beforePct, :final afterPct, :final rounds) =>
        Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(
            'Context compressed $beforePct% → $afterPct% ($rounds rounds)',
            style: theme.textTheme.labelSmall,
          ),
        ),
      SubtaskMessage(:final goal, :final status, :final partialOutput) => Card(
          margin: const EdgeInsets.symmetric(vertical: 6),
          child: ListTile(
            title: Text(goal, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              '${status.name}${partialOutput.isNotEmpty ? '\n$partialOutput' : ''}',
              maxLines: 8,
              overflow: TextOverflow.ellipsis,
            ),
            leading: Icon(
              status == SubtaskStatus.running
                  ? Icons.hourglass_top
                  : status == SubtaskStatus.done
                      ? Icons.check
                      : Icons.error_outline,
            ),
          ),
        ),
      ErrorMessage(:final message) => _bubble(
          context,
          alignment: Alignment.centerLeft,
          color: theme.colorScheme.errorContainer,
          child: Text(
            message,
            style: TextStyle(color: theme.colorScheme.onErrorContainer),
          ),
        ),
      ProviderRetryMessage(:final detail) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(detail, style: theme.textTheme.labelSmall),
        ),
    };
  }

  Widget _reasoningCard(
    BuildContext context, {
    required String title,
    required String body,
    required bool streaming,
  }) {
    final theme = Theme.of(context);
    final lim = LiminalTheme.of(context);
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 4),
      color: theme.colorScheme.surfaceContainerHigh,
      child: Padding(
        padding: const EdgeInsets.all(10),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(title, style: theme.textTheme.labelLarge),
                if (streaming) ...[
                  const SizedBox(width: 8),
                  const SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                ],
              ],
            ),
            if (body.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(
                body,
                maxLines: 24,
                overflow: TextOverflow.ellipsis,
                style: theme.textTheme.bodySmall?.copyWith(fontFamily: lim.fontFamilyMono),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _bubble(
    BuildContext context, {
    required Alignment alignment,
    required Color color,
    required Widget child,
    Border? border,
  }) {
    final radius = LiminalTheme.of(context).radius;
    return Align(
      alignment: alignment,
      child: Container(
        constraints: BoxConstraints(
          maxWidth: MediaQuery.sizeOf(context).width * 0.85,
        ),
        margin: const EdgeInsets.symmetric(vertical: 6),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: color,
          border: border,
          borderRadius: BorderRadius.circular(radius),
        ),
        child: child,
      ),
    );
  }

}

/// Collapsed by default — matches web `<details>Working state</details>`.
class _WorkingStatePanel extends StatelessWidget {
  const _WorkingStatePanel({
    this.goal,
    this.driftScore,
    this.subgoalsPreview,
    this.executionPreview,
  });

  final String? goal;
  final double? driftScore;
  final String? subgoalsPreview;
  final String? executionPreview;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final bodyStyle = Theme.of(context).textTheme.bodyMedium?.copyWith(
          color: lim.textMuted,
          height: 1.4,
        );
    final mono = LiminalTheme.mono(context, fontSize: 11, color: lim.textDim);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Theme(
        data: Theme.of(context).copyWith(dividerColor: lim.border),
        child: ExpansionTile(
          initiallyExpanded: false,
          tilePadding: const EdgeInsets.symmetric(horizontal: 4),
          childrenPadding: const EdgeInsets.fromLTRB(12, 0, 8, 8),
          backgroundColor: lim.surface.withValues(alpha: 0.4),
          collapsedBackgroundColor: lim.surface.withValues(alpha: 0.25),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(lim.radius),
            side: BorderSide(color: lim.border.withValues(alpha: 0.6)),
          ),
          collapsedShape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(lim.radius),
            side: BorderSide(color: lim.border.withValues(alpha: 0.45)),
          ),
          title: Text(
            'Working state',
            style: LiminalTheme.mono(context, fontSize: 12, color: lim.textMuted),
          ),
          children: [
            if (goal != null && goal!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text.rich(
                  TextSpan(
                    children: [
                      TextSpan(text: 'Goal: ', style: bodyStyle?.copyWith(fontWeight: FontWeight.w600)),
                      TextSpan(text: goal, style: bodyStyle),
                    ],
                  ),
                ),
              ),
            if (driftScore != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('Drift: ${driftScore!.toStringAsFixed(2)}', style: bodyStyle),
              ),
            if (subgoalsPreview != null && subgoalsPreview!.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 6),
                child: Text('Subgoals: $subgoalsPreview', style: bodyStyle),
              ),
            if (executionPreview != null && executionPreview!.isNotEmpty)
              SelectableText(executionPreview!, style: mono.copyWith(height: 1.45)),
          ],
        ),
      ),
    );
  }
}
