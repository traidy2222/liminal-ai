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
  final _name = TextEditingController();
  bool _spoken = false, _theme = false;

  @override
  void dispose() {
    _input.dispose();
    _name.dispose();
    super.dispose();
  }

  Future<void> _submit({bool skip = false}) async {
    final host = AppScope.of(context);
    if (!skip &&
        !await host.patchHarnessSettings({
          'AGENT_PERSONA_UI_THEME_LLM': _theme ? '1' : '0',
          'AGENT_PERSONA_UI_COPY': _theme ? '1' : '0',
        }))
      return;
    if (_spoken && !await host.patchHarnessSettings({'AGENT_TTS_ENABLED': '1'}))
      return;
    if (!mounted) return;
    await AppScope.of(context).submitPersonaBootstrap(
      skip ? 'skip' : _input.text,
      skip: skip,
      name: _name.text,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = AppScope.watch(context);
    final session = c.activeSession;

    return LiminalOnboardingPage(
      title: 'Make it your own',
      subtitle:
          '2 · Choose a writing personality. Describe a name, tone and style, or start immediately with the built-in personality. This is separate from the spoken voice. Your model connection is verified; style intensity starts at a moderate level.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _name,
            enabled: !c.setupSaving,
            maxLength: 80,
            decoration: const InputDecoration(
              labelText: 'Name (optional)',
              hintText: 'Sherlock Holmes',
              helperText:
                  'Used exactly as entered. Leave blank to infer it from your description.',
            ),
          ),
          const SizedBox(height: LiminalSpacing.sm),
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
          TextButton.icon(
            onPressed: c.setupSaving ? null : c.requestProviderSetup,
            icon: const Icon(Icons.arrow_back),
            label: const Text('Change model'),
          ),
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
            title: const Text('Match the interface to this personality'),
            subtitle: const Text(
              'Optional theme and labels. Adds generation time; leave off to keep the current design.',
            ),
            value: _theme,
            onChanged: c.setupSaving
                ? null
                : (value) => setState(() => _theme = value),
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
