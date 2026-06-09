import 'package:flutter/material.dart';

import '../../state/message_models.dart';
import '../chat/chat_message_frame.dart';
import '../chat/reasoning_block.dart';
import '../design_system/primitives/liminal_badge.dart';
import '../rich_message/liminal_message_content.dart';
import '../theme/liminal_theme_extension.dart';
import 'plan_progress_tile.dart';
import 'tool_activity_tile.dart';

class MessageTile extends StatelessWidget {
  const MessageTile({
    super.key,
    required this.entry,
    this.verboseTools = false,
    this.personaLabel = 'Assistant',
  });

  final MessageEntry entry;
  final bool verboseTools;
  final String personaLabel;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return switch (entry) {
      UserMessage(:final text, :final attachmentPreviews) =>
        ChatMessageFrame.user(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              if (attachmentPreviews.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Wrap(
                    spacing: 6,
                    runSpacing: 6,
                    alignment: WrapAlignment.end,
                    children: [
                      for (final a in attachmentPreviews)
                        LiminalBadge(
                          label: a.name,
                          tone: LiminalBadgeTone.neutral,
                          icon: Icons.image_outlined,
                        ),
                    ],
                  ),
                ),
              if (text.trim().isNotEmpty)
                SelectableText(
                  text,
                  style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                        color: lim.text,
                        height: 1.5,
                      ),
                ),
            ],
          ),
        ),
      AssistantMessage(:final text, :final streaming) =>
        ChatMessageFrame.assistant(
          roleLabel: personaLabel,
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Expanded(
                child: DefaultTextStyle(
                  style: Theme.of(context).textTheme.bodyLarge!.copyWith(
                        color: lim.text,
                        height: 1.65,
                      ),
                  child: LiminalMessageContent(text: text, streaming: streaming),
                ),
              ),
              if (streaming)
                Padding(
                  padding: const EdgeInsets.only(left: 8, bottom: 2),
                  child: SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: lim.assistantAccent,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ModelReasoningMessage(:final text, :final streaming) => ReasoningBlock(
          kind: ReasoningKind.model,
          title: 'Model reasoning',
          body: text,
          streaming: streaming,
          startExpanded: verboseTools,
        ),
      ThinkMessage(:final content, :final streaming, :final argsPreview) =>
        ReasoningBlock(
          kind: ReasoningKind.think,
          title: 'Reasoning',
          body: content.isNotEmpty ? content : argsPreview,
          streaming: streaming,
          startExpanded: verboseTools,
        ),
      ReasonMessage(
        :final inference,
        :final streaming,
        :final argsPreview,
        :final confidence,
      ) =>
        ReasoningBlock(
          kind: ReasoningKind.reason,
          title: 'Inference',
          body: inference.isNotEmpty ? inference : argsPreview,
          streaming: streaming,
          subtitle: confidence != null && confidence.isNotEmpty
              ? 'Confidence: $confidence'
              : null,
          startExpanded: verboseTools,
        ),
      PlanMessage(:final steps, :final streaming) =>
        PlanProgressTile(steps: steps, streaming: streaming),
      TraceMessage(:final text) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 2),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'trace',
                style: LiminalTheme.mono(context, fontSize: 9, color: lim.textDim),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  text,
                  style: LiminalTheme.mono(
                    context,
                    fontSize: 10,
                    color: lim.textDim,
                  ).copyWith(height: 1.35),
                ),
              ),
            ],
          ),
        ),
      ToolCallMessage message => ToolActivityTile(
          message: message,
          verbose: verboseTools,
        ),
      ToolResultMessage(:final output, :final ok) => const SizedBox.shrink(),
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
          child: DecoratedBox(
            decoration: BoxDecoration(
              border: Border(
                top: BorderSide(color: lim.border.withValues(alpha: 0.5)),
                bottom: BorderSide(color: lim.border.withValues(alpha: 0.35)),
              ),
            ),
            child: Padding(
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
                style: LiminalTheme.mono(context, fontSize: 10, color: lim.textDim),
              ),
            ),
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
            '⊙ Context compressed $beforePct% → $afterPct% ($rounds rounds)',
            style: LiminalTheme.mono(context, fontSize: 10, color: lim.textDim)
                .copyWith(fontStyle: FontStyle.italic),
          ),
        ),
      SubtaskMessage(:final goal, :final status, :final partialOutput) =>
        _SubtaskCard(goal: goal, status: status, partialOutput: partialOutput),
      ErrorMessage(:final message) => ChatMessageFrame.assistant(
          roleLabel: 'Error',
          child: Text(
            message,
            style: TextStyle(color: lim.danger, height: 1.45),
          ),
        ),
      ProviderRetryMessage(:final detail) => Padding(
          padding: const EdgeInsets.symmetric(vertical: 4),
          child: Text(
            detail,
            style: LiminalTheme.mono(context, fontSize: 11, color: lim.warn),
          ),
        ),
    };
  }
}

class _SubtaskCard extends StatelessWidget {
  const _SubtaskCard({
    required this.goal,
    required this.status,
    required this.partialOutput,
  });

  final String goal;
  final SubtaskStatus status;
  final String partialOutput;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final color = switch (status) {
      SubtaskStatus.running => lim.accent,
      SubtaskStatus.done => lim.success,
      SubtaskStatus.error => lim.danger,
      SubtaskStatus.cancelled => lim.textDim,
    };
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 4),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.45),
        borderRadius: BorderRadius.circular(lim.radius * 0.5),
        border: Border.all(color: color.withValues(alpha: 0.35)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            switch (status) {
              SubtaskStatus.running => Icons.hourglass_top,
              SubtaskStatus.done => Icons.check_circle_outline,
              SubtaskStatus.error => Icons.error_outline,
              SubtaskStatus.cancelled => Icons.cancel_outlined,
            },
            size: 16,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  goal,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        color: lim.text,
                        fontWeight: FontWeight.w600,
                      ),
                ),
                if (partialOutput.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      partialOutput,
                      maxLines: 6,
                      overflow: TextOverflow.ellipsis,
                      style: LiminalTheme.mono(context, fontSize: 11, color: lim.textMuted),
                    ),
                  ),
              ],
            ),
          ),
        ],
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
                      TextSpan(
                        text: 'Goal: ',
                        style: bodyStyle?.copyWith(fontWeight: FontWeight.w600),
                      ),
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
