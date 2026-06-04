import 'package:flutter/material.dart';

import '../../app/app_scope.dart';
import '../layout/liminal_spacing.dart';
import '../widgets/liminal_form_field.dart';
import '../widgets/liminal_shell.dart';

/// First-run provider setup — BYOK API key (same as web `.env` flow).
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _apiKey = TextEditingController();
  final _model = TextEditingController(text: 'deepseek/deepseek-v4-pro');
  final _baseUrl = TextEditingController(text: 'https://openrouter.ai/api/v1');

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final cfg = AppScope.of(context).config;
    if (cfg != null) {
      if (cfg.providerModel.isNotEmpty) _model.text = cfg.providerModel;
      if (cfg.providerBaseUrl.isNotEmpty) _baseUrl.text = cfg.providerBaseUrl;
    }
  }

  @override
  void dispose() {
    _apiKey.dispose();
    _model.dispose();
    _baseUrl.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final ok = await AppScope.of(context).saveProvider(
      apiKey: _apiKey.text,
      model: _model.text,
      baseUrl: _baseUrl.text,
    );
    if (ok && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Provider saved. Starting Liminal…')),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    final c = AppScope.watch(context);
    return LiminalOnboardingPage(
      title: 'Connect Liminal',
      subtitle:
          'Add your OpenRouter (or compatible) API key. It is stored locally in your repo `.env` and never sent back over the desktop socket.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          LiminalTextField(
            controller: _apiKey,
            label: 'API key',
            hint: 'sk-or-v1-…',
            obscure: true,
          ),
          LiminalTextField(
            controller: _model,
            label: 'Model',
            enabled: !(c.config?.modelLockedByEnv ?? false),
            helper: c.config?.modelLockedByEnv == true
                ? 'Locked by AGENT_MODEL in .env'
                : null,
          ),
          LiminalTextField(
            controller: _baseUrl,
            label: 'API base URL',
            enabled: !(c.config?.baseUrlLockedByEnv ?? false),
            helper: c.config?.baseUrlLockedByEnv == true
                ? 'Locked by AGENT_API_BASE_URL in .env'
                : null,
          ),
          if (c.setupError != null) ...[
            Padding(
              padding: const EdgeInsets.only(bottom: LiminalSpacing.sm),
              child: Text(
                c.setupError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          ],
          FilledButton(
            onPressed: c.setupSaving || _apiKey.text.trim().length < 8 ? null : _save,
            child: c.setupSaving
                ? const SizedBox(
                    height: 22,
                    width: 22,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Save and continue'),
          ),
          const SizedBox(height: LiminalSpacing.sm),
          Text(
            'Get a key at openrouter.ai — or point base URL to LM Studio / Ollama.',
            style: Theme.of(context).textTheme.bodySmall,
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
