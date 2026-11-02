import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../../core/update/update_coordinator.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/liminal_brand.dart';
import '../widgets/liminal_shell.dart';

class BootScreen extends StatelessWidget {
  const BootScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final updates = AppScope.watch(context).updates;
    return LiminalShell(
        showConnectionBanner: false,
        body: Center(
            child: Padding(
                padding: const EdgeInsets.all(32),
                child: ConstrainedBox(
                    constraints: const BoxConstraints(maxWidth: 400),
                    child: LaunchUpdateProgress(
                      active: updates.launchUpdateInProgress,
                      state: updates.state,
                      onSkip: updates.canSkipLaunchUpdate
                          ? updates.skipLaunchUpdate
                          : null,
                    )))));
  }
}

class LaunchUpdateProgress extends StatelessWidget {
  const LaunchUpdateProgress(
      {super.key, required this.active, required this.state, this.onSkip});
  final bool active;
  final UpdateState state;
  final VoidCallback? onSkip;
  @override
  Widget build(BuildContext context) {
    final downloading = active && state.phase == UpdatePhase.downloading;
    final applying = active && state.phase == UpdatePhase.applying;
    final message = applying
        ? 'Installing update…'
        : downloading
            ? 'Downloading Liminal ${state.checkResult?.latest.version ?? ''}…'
            : active
                ? 'Checking for updates…'
                : 'Opening your workspace…';
    return Column(mainAxisSize: MainAxisSize.min, children: [
      const LiminalBrandMark(),
      const SizedBox(height: 24),
      if (downloading)
        LinearProgressIndicator(value: state.downloadProgress)
      else
        CircularProgressIndicator(color: LiminalTheme.of(context).accent),
      const SizedBox(height: 16),
      Text(message, textAlign: TextAlign.center),
      if (downloading && state.downloadProgress != null)
        Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Text('${(state.downloadProgress! * 100).round()}%')),
      if (applying)
        const Padding(
            padding: EdgeInsets.only(top: 8),
            child: Text('Liminal will restart automatically.',
                textAlign: TextAlign.center)),
      if (onSkip != null)
        Padding(
            padding: const EdgeInsets.only(top: 16),
            child: TextButton(
                onPressed: onSkip, child: const Text('Open current version'))),
    ]);
  }
}

class StartingSidecarScreen extends StatefulWidget {
  const StartingSidecarScreen({super.key});

  @override
  State<StartingSidecarScreen> createState() => _StartingSidecarScreenState();
}

class _StartingSidecarScreenState extends State<StartingSidecarScreen> {
  bool _slow = false;

  @override
  void initState() {
    super.initState();
    Future<void>.delayed(const Duration(seconds: 45), () {
      if (mounted) setState(() => _slow = true);
    });
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final host = AppScope.watch(context);
    return LiminalShell(
      showConnectionBanner: false,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const LiminalBrandMark(
                subtitle: 'Starting harness',
              ),
              const SizedBox(height: 28),
              CircularProgressIndicator(color: lim.accent),
              const SizedBox(height: 16),
              Text(
                _slow
                    ? 'Still starting — first launch can take up to two minutes while tools register.'
                    : 'Starting harness — integrations (Google/Microsoft MCP) finish in the background.',
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
              if (_slow) ...[
                const SizedBox(height: 20),
                FilledButton(
                  onPressed: host.boot,
                  child: const Text('Retry connection'),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class ErrorBootScreen extends StatelessWidget {
  const ErrorBootScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    return LiminalShell(
      showConnectionBanner: false,
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    const LiminalBrandMark(compact: true),
                    const SizedBox(height: 16),
                    Text(
                      'Liminal could not start',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 12),
                    const Text('Check the details below, then try again.',
                        textAlign: TextAlign.center),
                    ExpansionTile(
                        title: const Text('Technical details'),
                        children: [
                          SizedBox(
                              height: 180,
                              child: SingleChildScrollView(
                                  child: SelectableText(host.bootError ??
                                      'No additional details.')))
                        ]),
                    const SizedBox(height: 16),
                    FilledButton(
                      onPressed: host.boot,
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class ConfigErrorScreen extends StatelessWidget {
  const ConfigErrorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final initErr = host.sidecarInitError?.trim();
    return LiminalOnboardingPage(
      title: initErr != null && initErr.isNotEmpty
          ? 'Harness failed to start'
          : 'Could not load configuration',
      subtitle: initErr ??
          host.setupError ??
          'Check that liminald is running and try again.',
      child: FilledButton(
        onPressed: initErr != null && initErr.isNotEmpty
            ? host.boot
            : host.refreshConfig,
        child: const Text('Retry'),
      ),
    );
  }
}
