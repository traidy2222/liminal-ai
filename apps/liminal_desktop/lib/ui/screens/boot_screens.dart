import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/liminal_brand.dart';
import '../widgets/liminal_shell.dart';

class BootScreen extends StatelessWidget {
  const BootScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return LiminalShell(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            const LiminalBrandMark(),
            const SizedBox(height: 24),
            CircularProgressIndicator(color: LiminalTheme.of(context).accent),
          ],
        ),
      ),
    );
  }
}

class StartingSidecarScreen extends StatelessWidget {
  const StartingSidecarScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return LiminalShell(
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
                'First launch can take up to a minute while tools register.',
                style: Theme.of(context).textTheme.bodySmall,
                textAlign: TextAlign.center,
              ),
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
                      'Could not start liminald',
                      style: Theme.of(context).textTheme.titleMedium,
                    ),
                    const SizedBox(height: 12),
                    Text(host.bootError ?? '', textAlign: TextAlign.center),
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
        onPressed: initErr != null && initErr.isNotEmpty ? host.boot : host.refreshConfig,
        child: const Text('Retry'),
      ),
    );
  }
}
