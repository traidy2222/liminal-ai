import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../app/app_scope.dart';
import '../widgets/liminal_shell.dart';

class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key});
  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _key = TextEditingController(), _model = TextEditingController();
  final _base = TextEditingController(text: 'https://openrouter.ai/api/v1');
  final _filter = TextEditingController();
  bool _local = false,
      _loading = false,
      _initialized = false,
      _savedKey = false;
  String? _savedBase;
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    if (_initialized) return;
    _initialized = true;
    final cfg = AppScope.of(context).config;
    if (cfg == null) return;
    _savedKey = cfg.apiKeyConfigured;
    _savedBase = cfg.providerBaseUrl;
    if (cfg.providerBaseUrl.isNotEmpty) _base.text = cfg.providerBaseUrl;
    _model.text = cfg.providerModel;
    _local =
        Uri.tryParse(_base.text)?.host == 'localhost' ||
        RegExp(r'^127\.').hasMatch(Uri.tryParse(_base.text)?.host ?? '');
  }

  bool get _canReuseKey =>
      _savedKey &&
      _base.text.trim().replaceAll(RegExp(r'/+$'), '') ==
          _savedBase?.replaceAll(RegExp(r'/+$'), '');
  String? _error;
  List<Map<String, dynamic>> _models = [];
  @override
  void dispose() {
    for (final c in [_key, _model, _base, _filter]) {
      c.dispose();
    }
    super.dispose();
  }

  void _choose(bool local) {
    setState(() {
      _local = local;
      _key.clear();
      _model.clear();
      _filter.clear();
      _models = [];
      _error = null;
      _base.text = local
          ? 'http://127.0.0.1:1234/v1'
          : 'https://openrouter.ai/api/v1';
    });
  }

  Future<void> _discover() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final models = await AppScope.of(context).discoverProviderModels(
        baseUrl: _base.text.trim(),
        apiKey: _key.text.trim(),
      );
      if (mounted)
        setState(() {
          _models = models;
          if (_local && models.length == 1)
            _model.text = models.first['id'] as String;
        });
    } catch (e) {
      if (mounted)
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _continue() async {
    if (_model.text.trim().isEmpty) {
      setState(() => _error = 'Choose or enter a model first.');
      return;
    }
    await AppScope.of(context).saveProvider(
      apiKey: _key.text,
      model: _model.text,
      baseUrl: _base.text,
      requireApiKey: !_local && !_canReuseKey,
    );
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context), busy = host.setupSaving || _loading;
    final query = _filter.text.trim().toLowerCase();
    final visible = _models
        .where(
          (m) =>
              '${m['id']} ${m['name']}'.toLowerCase().contains(query) &&
              m['toolCalling'] != false,
        )
        .take(80)
        .toList();
    return LiminalOnboardingPage(
      title: 'Choose your model',
      subtitle: '1 · Connect a model   →   2 · Make it your own',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(
                value: false,
                icon: Icon(Icons.cloud_outlined),
                label: Text('Cloud'),
              ),
              ButtonSegment(
                value: true,
                icon: Icon(Icons.computer),
                label: Text('Local'),
              ),
            ],
            selected: {_local},
            onSelectionChanged: busy ? null : (s) => _choose(s.first),
          ),
          const SizedBox(height: 20),
          Text(
            _local
                ? 'Run on your computer. Start LM Studio or Ollama and load a model that supports tools.'
                : 'Use OpenRouter to choose from cloud models. Requests use your provider credits; your key stays on this device.',
          ),
          if (_local)
            Wrap(
              spacing: 8,
              children: [
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          _base.text = 'http://127.0.0.1:1234/v1';
                          _models = [];
                          _model.clear();
                        }),
                  child: const Text('LM Studio'),
                ),
                TextButton(
                  onPressed: busy
                      ? null
                      : () => setState(() {
                          _base.text = 'http://127.0.0.1:11434/v1';
                          _models = [];
                          _model.clear();
                        }),
                  child: const Text('Ollama'),
                ),
              ],
            )
          else
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton(
                onPressed: () =>
                    launchUrl(Uri.parse('https://openrouter.ai/settings/keys')),
                child: const Text('Get an OpenRouter API key ↗'),
              ),
            ),
          TextField(
            controller: _base,
            enabled: !busy,
            onChanged: (_) => setState(() {
              _models = [];
            }),
            decoration: const InputDecoration(
              labelText: 'OpenAI-compatible API endpoint',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _key,
            enabled: !busy,
            obscureText: true,
            autocorrect: false,
            enableSuggestions: false,
            onChanged: (_) => setState(() {}),
            decoration: InputDecoration(
              labelText: _local ? 'Server key (optional)' : 'API key',
              hintText: _local
                  ? 'Leave empty for an unauthenticated local server'
                  : (_canReuseKey
                        ? 'Saved key will be verified'
                        : 'sk-or-v1-…'),
            ),
          ),
          const SizedBox(height: 12),
          OutlinedButton.icon(
            onPressed: busy ? null : _discover,
            icon: const Icon(Icons.refresh),
            label: Text(_loading ? 'Finding models…' : 'Load available models'),
          ),
          if (_models.isNotEmpty) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _filter,
              enabled: !busy,
              onChanged: (_) => setState(() {}),
              decoration: InputDecoration(
                labelText: 'Search ${_models.length} models',
                prefixIcon: const Icon(Icons.search),
              ),
            ),
            SizedBox(
              height: 180,
              child: ListView(
                children: visible
                    .map(
                      (m) => ListTile(
                        dense: true,
                        title: Text('${m['name']}'),
                        subtitle: Text('${m['id']}'),
                        selected: _model.text == m['id'],
                        onTap: busy
                            ? null
                            : () => setState(
                                () => _model.text = m['id'] as String,
                              ),
                      ),
                    )
                    .toList(),
              ),
            ),
          ],
          const SizedBox(height: 12),
          TextField(
            controller: _model,
            enabled: !busy,
            onChanged: (_) => setState(() {}),
            decoration: const InputDecoration(
              labelText: 'Selected model ID',
              helperText: 'Choose from the list, or enter an exact model ID.',
            ),
          ),
          const SizedBox(height: 16),
          if (_error != null || host.setupError != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: Text(
                _error ?? host.setupError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            ),
          FilledButton(
            onPressed:
                busy ||
                    _model.text.trim().isEmpty ||
                    (!_local && !_canReuseKey && _key.text.trim().length < 8)
                ? null
                : _continue,
            child: Text(
              host.setupSaving
                  ? 'Checking connection and tools…'
                  : 'Verify and continue',
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Verification sends one small tool-call request. Nothing is saved until it passes.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }
}
