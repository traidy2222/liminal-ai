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

  @override
  void dispose() {
    _input.dispose();
    super.dispose();
  }

  Future<void> _submit({bool skip = false}) async {
    await AppScope.of(context).submitPersonaBootstrap(
      skip ? 'skip' : _input.text,
      skip: skip,
    );
  }

  @override
  Widget build(BuildContext context) {
    final c = AppScope.watch(context);
    final session = c.activeSession;

    return LiminalOnboardingPage(
      title: 'How should I sound?',
      subtitle:
          'Describe the assistant personality you want — tone, style, name. Liminal will generate a persona profile before your first chat.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          TextField(
            controller: _input,
            enabled: !c.setupSaving,
            minLines: 4,
            maxLines: 8,
            decoration: const InputDecoration(
              labelText: 'Persona description',
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
                      Text(progress, style: Theme.of(context).textTheme.bodySmall),
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
                : const Text('Create persona'),
          ),
          if (c.config?.personaBootstrapAllowSkip ?? true) ...[
            const SizedBox(height: LiminalSpacing.xs),
            TextButton(
              onPressed: c.setupSaving ? null : () => _submit(skip: true),
              child: const Text('Skip — use default voice'),
            ),
          ],
        ],
      ),
    );
  }
}
