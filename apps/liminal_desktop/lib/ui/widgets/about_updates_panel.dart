import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/app_scope.dart';
import '../../core/update/local_versions.dart';
import '../../core/update/update_coordinator.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

class AboutUpdatesPanel extends StatefulWidget {
  const AboutUpdatesPanel({super.key});

  @override
  State<AboutUpdatesPanel> createState() => _AboutUpdatesPanelState();
}

class _AboutUpdatesPanelState extends State<AboutUpdatesPanel> {
  LocalVersions? _local;
  bool _loadingLocal = true;

  @override
  void initState() {
    super.initState();
    _loadLocal();
  }

  Future<void> _loadLocal() async {
    final host = AppScope.of(context);
    final local = await LocalVersions.load(repoRoot: host.repoRoot);
    if (mounted) {
      setState(() {
        _local = local;
        _loadingLocal = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final updates = host.updates;
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final local = _local;
    final result = updates.state.checkResult;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (_loadingLocal)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: LiminalSpacing.md),
            child: Center(child: CircularProgressIndicator()),
          )
        else if (local != null) ...[
          _row('App', local.appVersion),
          _row('Harness', local.harnessVersion ?? '—'),
          _row('Sidecar', host.sidecarVersion.isNotEmpty ? host.sidecarVersion : '—'),
          if (local.isDevBuild)
            Padding(
              padding: const EdgeInsets.only(top: LiminalSpacing.sm),
              child: Text(
                'Dev build — use git pull in the monorepo for harness updates.',
                style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
              ),
            ),
        ],
        const SizedBox(height: LiminalSpacing.md),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Check automatically on launch'),
          subtitle: Text(
            'Looks for new GitHub Releases when the app starts.',
            style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
          ),
          value: updates.prefs.autoCheckOnLaunch,
          onChanged: (v) => updates.savePrefs(
            updates.prefs.copyWith(autoCheckOnLaunch: v),
          ),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Include pre-releases'),
          subtitle: Text(
            'Beta channel — same feed during public preview.',
            style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
          ),
          value: updates.prefs.channel == 'beta',
          onChanged: (v) => updates.savePrefs(
            updates.prefs.copyWith(channel: v ? 'beta' : 'stable'),
          ),
        ),
        const SizedBox(height: LiminalSpacing.sm),
        if (updates.state.error != null)
          Padding(
            padding: const EdgeInsets.only(bottom: LiminalSpacing.sm),
            child: Text(
              updates.state.error!,
              style: TextStyle(color: theme.colorScheme.error),
            ),
          ),
        if (result != null && result.anyUpdate)
          Padding(
            padding: const EdgeInsets.only(bottom: LiminalSpacing.sm),
            child: Text(
              'Latest: v${result.latest.version} (${result.latest.tag})',
              style: theme.textTheme.bodyMedium,
            ),
          ),
        if (updates.state.phase == UpdatePhase.downloading &&
            updates.state.downloadProgress != null)
          Padding(
            padding: const EdgeInsets.only(bottom: LiminalSpacing.sm),
            child: LinearProgressIndicator(value: updates.state.downloadProgress),
          ),
        Wrap(
          spacing: LiminalSpacing.sm,
          runSpacing: LiminalSpacing.sm,
          children: [
            FilledButton(
              onPressed: updates.state.phase == UpdatePhase.checking ||
                      updates.state.phase == UpdatePhase.applying
                  ? null
                  : () => host.updates.check(),
              child: updates.state.phase == UpdatePhase.checking
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Check for updates'),
            ),
            if (result?.harnessUpdate == true)
              OutlinedButton(
                onPressed: updates.state.phase == UpdatePhase.applying
                    ? null
                    : () => host.updates.applyHarnessUpdate(),
                child: const Text('Update harness'),
              ),
            if (result?.appUpdate == true)
              OutlinedButton(
                onPressed: updates.state.phase == UpdatePhase.applying
                    ? null
                    : () => host.updates.scheduleAppRestart(),
                child: const Text('Restart to update app'),
              ),
            if (result != null)
              TextButton(
                onPressed: () => launchUrl(
                  Uri.parse(result.latest.notesUrl),
                  mode: LaunchMode.externalApplication,
                ),
                child: const Text('Release notes'),
              ),
          ],
        ),
      ],
    );
  }

  Widget _row(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: LiminalSpacing.xs),
      child: Row(
        children: [
          SizedBox(width: 88, child: Text(label)),
          Expanded(child: Text(value, style: const TextStyle(fontFamily: 'JetBrains Mono'))),
        ],
      ),
    );
  }
}
