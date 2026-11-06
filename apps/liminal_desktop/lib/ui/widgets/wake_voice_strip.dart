import 'dart:async';
import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:go_router/go_router.dart';
import '../../state/app_controller.dart';
import '../../routing/routes.dart';
import '../theme/liminal_theme_extension.dart';

/// Visible on every app screen, including when Mission Control is not focused.
class WakeVoiceStrip extends StatelessWidget {
  const WakeVoiceStrip({super.key});
  void _openSettings(BuildContext context) {
    if (GoRouterState.of(context).uri.path == AppRoutes.settings) return;
    context.push('${AppRoutes.settings}?section=session_ui');
  }

  @override
  Widget build(BuildContext context) {
    final host = context.watch<AppController?>();
    if (host == null) return const SizedBox.shrink();
    final voice = host.wakeVoice;
    if (host.config?.wakeVoice.enabled != true) return const SizedBox.shrink();
    final lim = LiminalTheme.of(context);
    final error = voice.error ?? voice.dictation.error;
    final speaking = host.speechOutput.isSpeaking;
    final label =
        error ??
        (voice.paused
            ? 'Wake listening paused'
            : !voice.listening
            ? 'Wake listener starting…'
            : voice.awake
            ? 'Mission Control · ${speaking ? "Speaking" : "Listening"}'
            : 'Say “${host.config!.wakeVoice.phrase}”');
    return Material(
      color: lim.accent.withValues(alpha: .08),
      child: SafeArea(
        bottom: false,
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
          child: Wrap(
            crossAxisAlignment: WrapCrossAlignment.center,
            spacing: 10,
            runSpacing: 4,
            children: [
              Icon(
                voice.paused ? Icons.mic_off_outlined : Icons.hearing_outlined,
                size: 17,
                color: lim.accent,
              ),
              ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 600),
                child: Text(
                  label,
                  style: Theme.of(context).textTheme.bodySmall,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              if (voice.pendingCount > 0)
                Text(
                  '${voice.pendingCount} request(s) queued',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              if (host.orchestration.isActive)
                Text(
                  'Workers: ${host.orchestration.status}',
                  style: Theme.of(context).textTheme.labelSmall,
                ),
              if (host.config?.ttsEnabled != true)
                TextButton(
                  onPressed: () => _openSettings(context),
                  child: const Text('Spoken replies off · Voice settings'),
                ),
              if (speaking)
                TextButton(
                  onPressed: host.speechOutput.interrupt,
                  child: const Text('Interrupt'),
                ),
              if (voice.awake)
                TextButton(
                  onPressed: () => unawaited(voice.sleep()),
                  child: const Text('Go to sleep'),
                ),
              if (error != null && voice.pendingCount > 0)
                TextButton(
                  onPressed: voice.retryPending,
                  child: const Text('Resend request'),
                ),
              TextButton(
                onPressed: () => unawaited(host.toggleWakeListening()),
                child: Text(
                  voice.listening && !voice.paused
                      ? 'Pause listening'
                      : 'Resume listening',
                ),
              ),
              IconButton(
                tooltip: 'Configure wake phrase',
                onPressed: () => _openSettings(context),
                icon: const Icon(Icons.tune, size: 17),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
