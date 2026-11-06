import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../layout/liminal_spacing.dart';
import '../widgets/liminal_shell.dart';

/// First-run persona voice setup (mirrors web persona bootstrap modal).
class PersonaBootstrapScreen extends StatefulWidget {
  const PersonaBootstrapScreen({super.key});

  @override
  State<PersonaBootstrapScreen> createState() => _PersonaBootstrapScreenState();
}

class _PersonaBootstrapScreenState extends State<PersonaBootstrapScreen> {
  final _input = TextEditingController();
  bool _spoken = false;

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _submit({bool skip = false}) async {
    final host = AppScope.of(context);
    if (_spoken && !await host.patchHarnessSettings({'AGENT_TTS_ENABLED': '1'}))
      return;
    if (!mounted) return;
    await AppScope.of(
      context,
    ).submitPersonaBootstrap(skip ? 'skip' : _input.text, skip: skip);
  }

  @override
  Widget build(BuildContext context) {
    final c = AppScope.watch(context);
    final session = c.activeSession;

    return LiminalOnboardingPage(
      title: 'Make it your own',
      subtitle:
          '2 · Choose a writing personality. Describe a name, tone and style, or start immediately with the built-in personality. This is separate from the spoken voice.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _input,
            enabled: !c.setupSaving,
            onChanged: (_) => setState(() {}),
            minLines: 4,
            maxLines: 8,
            decoration: const InputDecoration(
              labelText: 'Writing personality',
              hintText: 'e.g. Sharp, concise coding partner named Aria…',
              alignLabelWithHint: true,
            ),
          ),
          if (session != null)
            ListenableBuilder(
              listenable: session,
              builder: (context, _) {
                final progress = session.personaBootstrapProgress;
                if (progress == null || progress.isEmpty) {
                  return const SizedBox(height: LiminalSpacing.md);
                }
                return Padding(
                  padding: const EdgeInsets.only(top: LiminalSpacing.md),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      const LinearProgressIndicator(),
                      const SizedBox(height: LiminalSpacing.xs),
                      Text(
                        progress,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      ...session.personaBootstrapArtifacts
                          .where(
                            (a) => (a['content'] as String? ?? '').isNotEmpty,
                          )
                          .map(
                            (a) => ExpansionTile(
                              title: Text(
                                '${a['label'] ?? a['id']} · ${a['status']}',
                              ),
                              children: [
                                SelectableText(
                                  (a['content'] as String).length > 4000
                                      ? (a['content'] as String).substring(
                                          0,
                                          4000,
                                        )
                                      : a['content'] as String,
                                ),
                              ],
                            ),
                          ),
                    ],
                  ),
                );
              },
            )
          else
            const SizedBox(height: LiminalSpacing.md),
          if (c.setupError != null) ...[
            const SizedBox(height: LiminalSpacing.sm),
            Text(
              c.setupError!,
              style: TextStyle(color: Theme.of(context).colorScheme.error),
            ),
          ],
          const SizedBox(height: LiminalSpacing.lg),
          FilledButton(
            onPressed: c.setupSaving || _input.text.trim().isEmpty
                ? null
                : () => _submit(),
            child: c.setupSaving
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Generate personality and start'),
          ),
          if (c.setupSaving)
            TextButton(
              onPressed: () => c.cancelPersonaBootstrap(),
              child: const Text('Cancel generation'),
            ),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Spoken replies (optional)'),
            subtitle: const Text(
              'Enable the configured speech voice. Microphone and wake word can be set up later in Settings.',
            ),
            value: _spoken,
            onChanged: c.setupSaving
                ? null
                : (value) => setState(() => _spoken = value),
          ),
          if (c.config?.personaBootstrapAllowSkip ?? true) ...[
            const SizedBox(height: LiminalSpacing.xs),
            TextButton(
              onPressed: c.setupSaving ? null : () => _submit(skip: true),
              child: const Text('Use built-in personality'),
            ),
          ],
        ],
      ),
    );
  }
}
