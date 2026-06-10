import 'package:flutter/material.dart';

import '../design_system/primitives/liminal_badge.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

bool _isPlanStepDone(String step) => step.startsWith('✓');

String _planStepLabel(String step) =>
    _isPlanStepDone(step) ? step.replaceFirst(RegExp(r'^✓\s*'), '') : step;

int _countPlanStepsDone(List<String> steps) =>
    steps.where(_isPlanStepDone).length;

/// Single in-place plan tracker — one card per turn, steps check off as work proceeds.
class PlanProgressTile extends StatelessWidget {
  const PlanProgressTile({
    super.key,
    required this.steps,
    this.streaming = false,
  });

  final List<String> steps;
  final bool streaming;

  @override
  Widget build(BuildContext context) {
    if (steps.isEmpty) return const SizedBox.shrink();

    final lim = LiminalTheme.of(context);
    final done = _countPlanStepsDone(steps);
    final total = steps.length;
    final activeIndex = steps.indexWhere((s) => !_isPlanStepDone(s));
    final progress = total > 0 ? done / total : 0.0;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.symmetric(vertical: 2),
      padding: const EdgeInsets.all(LiminalSpacing.sm),
      decoration: BoxDecoration(
        color: lim.panel.withValues(alpha: 0.5),
        borderRadius: BorderRadius.circular(lim.radius * 0.55),
        border: Border.all(color: lim.border),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.route_outlined, size: 14, color: lim.accent),
              const SizedBox(width: 6),
              Text(
                'PLAN',
                style: LiminalTheme.mono(
                  context,
                  fontSize: 10,
                  fontWeight: FontWeight.w700,
                  color: lim.accent,
                ).copyWith(letterSpacing: 0.08),
              ),
              const Spacer(),
              LiminalBadge(label: '$done/$total', tone: LiminalBadgeTone.accent),
              if (streaming) ...[
                const SizedBox(width: 8),
                SizedBox(
                  width: 12,
                  height: 12,
                  child: CircularProgressIndicator(strokeWidth: 2, color: lim.accent),
                ),
              ],
            ],
          ),
          const SizedBox(height: 8),
          ClipRRect(
            borderRadius: BorderRadius.circular(2),
            child: LinearProgressIndicator(
              value: progress,
              minHeight: 3,
              backgroundColor: lim.textDim.withValues(alpha: 0.15),
              color: lim.accent,
            ),
          ),
          const SizedBox(height: 10),
          for (var i = 0; i < steps.length; i++)
            _PlanStepRow(
              index: i,
              step: steps[i],
              active: i == activeIndex,
              lim: lim,
            ),
        ],
      ),
    );
  }
}

class _PlanStepRow extends StatelessWidget {
  const _PlanStepRow({
    required this.index,
    required this.step,
    required this.active,
    required this.lim,
  });

  final int index;
  final String step;
  final bool active;
  final LiminalTokens lim;

  @override
  Widget build(BuildContext context) {
    final complete = _isPlanStepDone(step);
    final text = complete ? _planStepLabel(step) : step;
    final color = complete
        ? lim.textDim
        : active
            ? lim.accent
            : lim.textMuted;

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            complete
                ? Icons.check_circle_outline
                : active
                    ? Icons.play_arrow
                    : Icons.circle_outlined,
            size: 14,
            color: color,
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: color,
                    decoration: complete ? TextDecoration.lineThrough : null,
                    decorationColor: lim.textDim,
                    height: 1.4,
                    fontWeight: active ? FontWeight.w600 : FontWeight.w400,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
