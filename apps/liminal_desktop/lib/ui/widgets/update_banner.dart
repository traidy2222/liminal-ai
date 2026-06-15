import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../core/update/update_coordinator.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

class UpdateBanner extends StatelessWidget {
  const UpdateBanner({super.key});

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final updates = host.updates;
    if (!updates.showBanner) return const SizedBox.shrink();

    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final result = updates.state.checkResult;
    if (result == null) return const SizedBox.shrink();

    final version = result.latest.version;
    final harness = result.harnessUpdate;
    final app = result.appUpdate;

    return Padding(
      padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
      child: Material(
        color: lim.accent.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(LiminalSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Update available — v$version',
                style: theme.textTheme.titleSmall?.copyWith(
                  color: lim.accent,
                  fontWeight: FontWeight.w600,
                ),
              ),
              const SizedBox(height: LiminalSpacing.xs),
              Text(
                [
                  if (harness) 'Harness update ready',
                  if (app) 'App update requires restart',
                ].join(' · '),
                style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
              ),
              if (updates.state.phase == UpdatePhase.downloading &&
                  updates.state.downloadProgress != null)
                Padding(
                  padding: const EdgeInsets.only(top: LiminalSpacing.sm),
                  child: LinearProgressIndicator(
                    value: updates.state.downloadProgress,
                    backgroundColor: lim.panel,
                  ),
                ),
              const SizedBox(height: LiminalSpacing.sm),
              Wrap(
                spacing: LiminalSpacing.sm,
                runSpacing: LiminalSpacing.sm,
                children: [
                  if (harness)
                    FilledButton(
                      onPressed: updates.state.phase == UpdatePhase.applying
                          ? null
                          : () => host.updates.applyHarnessUpdate(),
                      child: const Text('Update harness'),
                    ),
                  if (app)
                    OutlinedButton(
                      onPressed: updates.state.phase == UpdatePhase.applying
                          ? null
                          : () => host.updates.scheduleAppRestart(),
                      child: const Text('Restart to update app'),
                    ),
                  TextButton(
                    onPressed: () => host.updates.dismissBanner(),
                    child: const Text('Dismiss'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
