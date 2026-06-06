import 'package:flutter/material.dart';

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

    final theme = Theme.of(context);
    final lim = LiminalTheme.of(context);
    final done = _countPlanStepsDone(steps);
    final total = steps.length;
    final activeIndex = steps.indexWhere((s) => !_isPlanStepDone(s));
    final progress = total > 0 ? done / total : 0.0;

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      elevation: 0,
      color: theme.colorScheme.surfaceContainerHighest.withValues(alpha: 0.35),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(10),
        side: BorderSide(
          color: lim.accent.withValues(alpha: 0.25),
          width: 1,
        ),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 12, 14, 12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Text(
                  'Progress',
                  style: theme.textTheme.titleSmall?.copyWith(
                    color: lim.accent,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const Spacer(),
                Text(
                  '$done/$total',
                  style: LiminalTheme.mono(
                    context,
                    fontSize: 11,
                    color: lim.textDim,
                  ),
                ),
                if (streaming) ...[
                  const SizedBox(width: 8),
                  SizedBox(
                    width: 12,
                    height: 12,
                    child: CircularProgressIndicator(
                      strokeWidth: 2,
                      color: lim.accent,
                    ),
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
                theme: theme,
              ),
          ],
        ),
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
    required this.theme,
  });

  final int index;
  final String step;
  final bool active;
  final LiminalTokens lim;
  final ThemeData theme;

  @override
  Widget build(BuildContext context) {
    final complete = _isPlanStepDone(step);
    final text = complete ? _planStepLabel(step) : step;
    final marker = complete ? '✓' : (active ? '▸' : '○');
    final color = complete
        ? lim.textDim
        : active
            ? lim.accent
            : theme.colorScheme.onSurface.withValues(alpha: 0.7);

    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 18,
            child: Text(
              marker,
              style: TextStyle(
                color: color,
                fontSize: 12,
                fontWeight: active ? FontWeight.w700 : FontWeight.w400,
              ),
            ),
          ),
          Expanded(
            child: Text(
              text,
              style: theme.textTheme.bodySmall?.copyWith(
                color: color,
                decoration: complete ? TextDecoration.lineThrough : null,
                decorationColor: lim.textDim,
                height: 1.4,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
