import '../../models/openrouter_catalog.dart';
import '../widgets/openrouter_model_picker.dart';
import 'dart:collection';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../core/feature_flags.dart';
import '../../models/app_config.dart';
import '../../models/harness_settings.dart';
import '../../models/managed_inference_catalog.dart';
import '../../models/liminal_app_spec.dart';
import '../../models/vireon_account.dart';
import '../layout/liminal_breakpoints.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../design_system/liminal_design_system.dart';
import '../widgets/liminal_form_field.dart';
import '../widgets/settings_workspace.dart';
import '../../models/settings_presentation.dart';
import '../widgets/liminal_shell.dart';
import '../widgets/managed_inference_panel.dart';
import '../widgets/about_updates_panel.dart';

/// Harness fields surfaced on Integrations instead of Settings.
const _integrationsHarnessSubgroups = {'inbox_watch'};

List<HarnessSettingsField> _settingsVisibleHarnessFields(
  List<HarnessSettingsField> fields,
) {
  return fields
      .where((f) =>
          !_integrationsHarnessSubgroups.contains(f.subgroupId) &&
          !const {'AGENT_INFERENCE_MODE', 'AGENT_MANAGED_PROVIDER', 'AGENT_SINGLE_MODEL'}
              .contains(f.key),)
      .toList();
}

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final _apiKey = TextEditingController();
  final _model = TextEditingController();
  final _baseUrl = TextEditingController();
  final Map<String, TextEditingController> _fieldControllers = {};
  final _search = TextEditingController();
  String _selected = 'models_api';
  bool _advanced = false;
  bool _saving = false;
  String? _error;
  String _inferenceMode = 'auto';
  String _managedProvider = 'auto';

  @override
  void initState() {
    super.initState();
    _search.addListener(_onSearchChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final cfg = AppScope.of(context).config;
      if (cfg != null) {
        _model.text = cfg.providerModel;
        _baseUrl.text = cfg.providerBaseUrl;
      }
      await AppScope.of(context).loadVireonAccount();
      await Future.wait([
        AppScope.of(context).loadHarnessSettings(),
        if (LiminalFeatureFlags.desktopAppsEnabled)
          AppScope.of(context).loadDesktopApps(),
      ]);
      if (mounted) {
        _syncFieldControllers();
        await AppScope.of(context).loadManagedInferenceModels();
      }
    });
  }

  void _syncProviderControllersFromHost() {
    final host = AppScope.of(context);
    final cfg = host.config;
    final snap = host.harnessSettings;
    if (cfg != null) {
      _model.text = cfg.providerModel;
      _baseUrl.text = cfg.providerBaseUrl;
    } else if (snap != null) {
      _model.text = snap.provider.model;
      _baseUrl.text = snap.provider.baseURL;
    }
  }

  String _fastModelFromSnapshot(HarnessSettingsSnapshot? snap) {
    if (snap == null) return '';
    for (final f in snap.fields) {
      if (f.key == 'AGENT_FAST_MODEL') return f.value.trim();
    }
    return '';
  }

  Future<void> _onManagedMainModel(String modelId) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final ok = await AppScope.of(context)
        .patchManagedInferenceModels(mainModel: modelId);
    if (!mounted) return;
    if (ok) {
      _syncProviderControllersFromHost();
      _syncFieldControllers();
    } else {
      _error = 'Failed to update main model';
    }
    setState(() => _saving = false);
  }

  Future<void> _onManagedFastModel(String modelId) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final ok = await AppScope.of(context)
        .patchManagedInferenceModels(fastModel: modelId);
    if (!mounted) return;
    if (!ok) _error = 'Failed to update fast model';
    setState(() => _saving = false);
  }

  Future<void> _onInferenceModeChanged(String? mode) async {
    if (mode == null || mode == _inferenceMode) return;
    setState(() {
      _saving = true;
      _error = null;
      _inferenceMode = mode;
    });
    final ok = await AppScope.of(context).patchManagedInferenceModels(
      inferenceMode: mode,
      managedProvider: _managedProvider,
    );
    if (!mounted) return;
    if (ok) {
      _syncFieldControllers();
      await AppScope.of(context).loadManagedInferenceModels();
    } else {
      _error = 'Failed to update inference mode';
    }
    setState(() => _saving = false);
  }

  Future<void> _onManagedProviderChanged(String? provider) async {
    if (provider == null || provider == _managedProvider) return;
    setState(() {
      _saving = true;
      _error = null;
      _managedProvider = provider;
    });
    final host = AppScope.of(context);
    final snap = host.harnessSettings;
    final currentMain = snap?.provider.model ?? _model.text;
    final catalog = host.managedInferenceModels?.models ?? const [];
    final remapped = resolveManagedModelForProviderPreference(
      currentMain,
      catalog,
      provider,
    );
    final ok = await AppScope.of(context).patchManagedInferenceModels(
      managedProvider: provider,
      inferenceMode: _inferenceMode,
      mainModel: remapped != currentMain.trim() ? remapped : null,
    );
    if (!mounted) return;
    if (ok) {
      _syncProviderControllersFromHost();
      _syncFieldControllers();
    } else {
      _error = 'Failed to update managed upstream';
    }
    setState(() => _saving = false);
  }

  String _readHarnessEnvField(
      HarnessSettingsSnapshot snap, String key, String fallback,) {
    for (final f in snap.fields) {
      if (f.key == key && f.value.trim().isNotEmpty) return f.value.trim();
    }
    return fallback;
  }

  void _syncFieldControllers() {
    final snap = AppScope.of(context).harnessSettings;
    if (snap == null) return;
    final fromProvider = snap.provider.inferenceMode?.trim();
    _inferenceMode = (fromProvider != null && fromProvider.isNotEmpty)
        ? fromProvider.toLowerCase()
        : _readHarnessEnvField(snap, 'AGENT_INFERENCE_MODE', 'auto')
            .toLowerCase();
    _managedProvider =
        _readHarnessEnvField(snap, 'AGENT_MANAGED_PROVIDER', 'auto')
            .toLowerCase();
    for (final f in snap.fields) {
      if (f.valueKind == 'boolean' || f.valueKind == 'enum') continue;
      _fieldControllers.putIfAbsent(
          f.key, () => TextEditingController(text: f.value),);
    }
    setState(() {});
  }

  void _onSearchChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _search.removeListener(_onSearchChanged);
    _search.dispose();
    _apiKey.dispose();
    _model.dispose();
    _baseUrl.dispose();
    for (final c in _fieldControllers.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _applyBedrockPreset(String presetId) async {
    if (presetId == 'custom') return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final ok = await AppScope.of(context).applyBedrockPreset(presetId);
    if (!mounted) return;
    final snap = AppScope.of(context).harnessSettings;
    final cfg = AppScope.of(context).config;
    if (ok) {
      if (cfg != null) {
        _model.text = cfg.providerModel;
      } else if (snap != null) {
        _model.text = snap.provider.model;
      }
      _syncFieldControllers();
    }
    setState(() {
      _saving = false;
      if (!ok) {
        _error =
            AppScope.of(context).setupError ?? 'Failed to apply Bedrock preset';
      }
    });
  }

  Future<void> _applyProviderPreset(String presetId) async {
    if (presetId == 'custom') return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final ok = await AppScope.of(context).applyProviderPreset(presetId);
    if (!mounted) return;
    final snap = AppScope.of(context).harnessSettings;
    final cfg = AppScope.of(context).config;
    if (ok) {
      if (cfg != null) {
        _model.text = cfg.providerModel;
        _baseUrl.text = cfg.providerBaseUrl;
      } else if (snap != null) {
        _model.text = snap.provider.model;
        _baseUrl.text = snap.provider.baseURL;
      }
      _syncFieldControllers();
    }
    setState(() {
      _saving = false;
      if (!ok) {
        _error = AppScope.of(context).setupError ??
            'Failed to apply provider preset';
      }
    });
  }

  Future<void> _saveProvider() async {
    final single = AppScope.of(context).harnessSettings?.fields.any((f) => f.key == 'AGENT_SINGLE_MODEL' && const {'1', 'on', 'true', 'yes'}.contains(f.value)) ?? false;
    if (single && OpenRouterCatalogModel.isRouterId(_model.text)) {
      setState(() => _error = 'Choose a specific model while single-model mode is enabled.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final ok = await AppScope.of(context).saveProvider(
      apiKey: _apiKey.text,
      model: _model.text,
      baseUrl: _baseUrl.text,
      requireApiKey: _apiKey.text.trim().isNotEmpty,
    );
    if (mounted) {
      setState(() {
        _saving = false;
        if (!ok) _error = AppScope.of(context).setupError;
      });
    }
  }

  Future<void> _saveHarnessField(
      HarnessSettingsField field, String value,) async {
    if (field.key == 'AGENT_SINGLE_MODEL' && value == '1' && OpenRouterCatalogModel.isRouterId(_model.text)) {
      setState(() => _error = 'Choose a specific model before enabling single-model mode.');
      return;
    }
    setState(() => _saving = true);
    final ok = await AppScope.of(context).patchHarnessSettings({
      field.key: _envValue(field, value),
    });
    if (mounted) {
      setState(() => _saving = false);
      if (!ok) {
        setState(() => _error = 'Failed to update ${field.label}');
      } else {
        await AppScope.of(context).loadHarnessSettings();
        if (mounted) _syncFieldControllers();
      }
    }
  }

  String _envValue(HarnessSettingsField field, String raw) {
    if (field.valueKind == 'boolean') {
      final on = raw == 'true' || raw == '1';
      return on ? '1' : '0';
    }
    return raw.trim();
  }

  @override
  Widget build(BuildContext context) {
    final host = AppScope.watch(context);
    final cfg = host.config;
    final snap = host.harnessSettings;
    final lim = LiminalTheme.of(context);
    final query = _search.text.trim().toLowerCase();
    final searchActive = query.isNotEmpty;
    final singleField = snap?.fields.where((f) => f.key == 'AGENT_SINGLE_MODEL').firstOrNull;
    final singleModel = const {'1', 'true', 'on', 'yes'}.contains(singleField?.value);
    final allFields = _settingsVisibleHarnessFields(snap?.fields ?? const []).where((f) => !(singleModel && f.key != 'AGENT_MODEL' && f.key.endsWith('_MODEL'))).toList();
    final categoryFields = allFields
        .where((f) => settingsCategory(f.tabId, f.key) == _selected)
        .toList();
    final fields = searchActive
        ? allFields
            .where((f) =>
                harnessFieldMatchesSearch(f, query) ||
                (everydaySettings[f.key]?.label.toLowerCase().contains(query) ??
                    false),)
            .toList()
        : categoryFields
            .where((f) =>
                _advanced ||
                _selected == 'advanced' ||
                everydaySettings.containsKey(f.key),)
            .toList();
    final hidden = categoryFields.length - fields.length;
    final account = LiminalSection(
      title: 'Vireon account',
      subtitle:
          'Manage your sign-in and plan. A local workspace does not require an account.',
      child: _VireonAccountPanel(
        snapshot: host.vireonAccount,
        loading: host.vireonAccountLoading,
        busy: host.vireonAuthBusy,
        error: host.vireonAuthError,
        onSignIn: () async {
          setState(() => _error = null);
          final ok = await AppScope.of(context).signInToVireon();
          if (!mounted) return;
          if (ok) {
            _syncProviderControllersFromHost();
            _syncFieldControllers();
          } else {
            setState(() => _error = AppScope.of(context).vireonAuthError);
          }
        },
        onSignOut: () async {
          setState(() => _error = null);
          final ok = await AppScope.of(context).signOutOfVireon();
          if (mounted && !ok) {
            setState(() => _error = AppScope.of(context).vireonAuthError);
          }
        },
      ),
    );
    final about = LiminalSection(
      title: 'About & updates',
      subtitle: 'Your installed version and available updates.',
      child: const AboutUpdatesPanel(),
    );
    final apps = LiminalSection(
      title: 'Desktop apps',
      subtitle: 'Separate OS windows spawned by the agent or opened from here. '
          'Closing a window does not remove the app.',
      child: _DesktopAppsPanel(
        apps: host.desktopApps,
        caches: host.desktopAppCaches,
        loading: host.desktopAppsLoading,
        onOpen: (id) => AppScope.of(context).openDesktopAppWindow(id),
        onRemove: (id) => AppScope.of(context).removeDesktopApp(id),
        onRefresh: (id) => AppScope.of(context).refreshDesktopApp(id),
        onUpdate: (id, props, autoOpen) => AppScope.of(context)
            .updateDesktopApp(appId: id, props: props, autoOpen: autoOpen),
      ),
    );
    final provider = LiminalSection(
      title: 'Model & provider',
      subtitle: _inferenceMode == 'byok'
          ? 'Bring your own key — API keys live in `.env` only.'
          : _inferenceMode == 'managed'
              ? 'Pro managed inference — routed through Vireon.'
              : 'Choose how Liminal connects to a model.',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text('How to connect', style: Theme.of(context).textTheme.titleSmall),
          const SizedBox(height: LiminalSpacing.xs),
          DropdownButtonFormField<String>(
            value: _inferenceMode,
            isExpanded: true,
            decoration: const InputDecoration(isDense: true),
            items: const [
              DropdownMenuItem(
                value: 'auto',
                child: Text('Automatic'),
              ),
              DropdownMenuItem(
                value: 'byok',
                child: Text('Use my own API key'),
              ),
              DropdownMenuItem(
                value: 'managed',
                child: Text('Use Vireon credits'),
              ),
            ],
            onChanged: _saving ? null : _onInferenceModeChanged,
          ),
          if (singleField != null) SwitchListTile(
            contentPadding: EdgeInsets.zero, title: const Text('Use one model for everything'),
            subtitle: const Text('Chat, background work, and vision use the selected model. Separate embeddings, speech models, and automatic model fallbacks are off. Previous choices are kept.'),
            value: singleModel, onChanged: _saving || singleField.lockedByEnv ? null : (v) => _saveHarnessField(singleField, v ? '1' : '0'),
          ),
          if ((_inferenceMode == 'managed' || (_inferenceMode == 'auto' && (cfg?.providerBaseUrl ?? snap?.provider.baseURL ?? '').contains('/inference'))) && host.vireonAccount.connected) ...[
            const SizedBox(height: LiminalSpacing.md),
            ManagedInferencePanel(
              singleModel: singleModel,
              loadOpenRouter: host.loadOpenRouterModels,
              mainModel: snap?.provider.model ?? _model.text,
              fastModel: _fastModelFromSnapshot(snap),
              catalog: host.managedInferenceModels,
              loading: host.managedInferenceModelsLoading,
              error: host.managedInferenceModelsError,
              saving: _saving,
              managedProvider: _managedProvider,
              bedrockPresets: snap?.bedrockPresets ?? const [],
              selectedBedrockPresetId: BedrockModelPreset.resolveSelection(
                snap?.bedrockPresets ?? const [],
                snap?.provider.model ?? _model.text,
                _fastModelFromSnapshot(snap),
              ),
              onBedrockPresetApply: _applyBedrockPreset,
              onManagedProvider: _onManagedProviderChanged,
              onMainModel: _onManagedMainModel,
              onFastModel: _onManagedFastModel,
            ),
          ],
          if (_inferenceMode != 'managed' && !(_inferenceMode == 'auto' && host.vireonAccount.connected && (cfg?.providerBaseUrl ?? snap?.provider.baseURL ?? '').contains('/inference'))) ...[
            const SizedBox(height: LiminalSpacing.md),
            _ProviderForm(
              singleModel: singleModel,
              apiKey: _apiKey,
              model: _model,
              baseUrl: _baseUrl,
              cfg: cfg,
              provider: snap?.provider,
              presets: snap?.providerPresets ?? const [],
              backends: snap?.providerBackends.isNotEmpty == true
                  ? snap!.providerBackends
                  : HarnessSettingsSnapshot.defaultBackends(),
              saving: _saving,
              onSave: _saveProvider,
              onPresetApply: _applyProviderPreset,
            ),
          ],
        ],
      ),
    );
    return LiminalShell(
      appBar: _appBar(context),
      body: SettingsWorkspace(
        selected: _selected,
        onSelect: (id) => setState(() {
          _selected = id;
          _advanced = false;
          _search.clear();
        }),
        search: _search,
        onSearch: (_) => setState(() {}),
        child:
            Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          if (host.harnessSettingsLoading && snap == null)
            const LinearProgressIndicator(),
          if (_error != null)
            Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: Text(_error!, style: TextStyle(color: lim.danger)),),
          if (searchActive) ...[
            Text('Search results · ${fields.length}',
                style: Theme.of(context).textTheme.headlineSmall,),
            const SizedBox(height: 8),
            Text('Includes everyday and advanced settings.',
                style: TextStyle(color: lim.textMuted),),
          ] else ...[
            if (_selected == 'account') account,
            if (_selected == 'about') about,
            if (_selected == 'models_api') provider,
            if (_selected != 'account' &&
                _selected != 'about' &&
                _selected != 'models_api') ...[
              Text(
                  settingsDestinations
                      .firstWhere((d) => d.id == _selected)
                      .title,
                  style: Theme.of(context).textTheme.headlineMedium,),
              const SizedBox(height: 8),
              Text(
                  _selected == 'advanced'
                      ? 'Fine-tune tools, execution, and diagnostics. Defaults work for most people.'
                      : 'The choices you are most likely to need.',
                  style: TextStyle(color: lim.textMuted, height: 1.5),),
            ],
          ],
          if (searchActive ||
              (_selected != 'account' && _selected != 'about')) ...[
            const SizedBox(height: 24),
            if (!searchActive &&
                _selected != 'advanced' &&
                (hidden > 0 || _advanced))
              SwitchListTile.adaptive(
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Show advanced options'),
                  subtitle: Text(_advanced
                      ? 'Showing all options in this category.'
                      : '$hidden additional options available.',),
                  value: _advanced,
                  onChanged: (v) => setState(() => _advanced = v),),
            if (fields.isEmpty && (searchActive || hidden > 0))
              Padding(
                  padding: const EdgeInsets.symmetric(vertical: 20),
                  child: Text(
                      searchActive
                          ? 'No matching settings. Try another name or keyword.'
                          : 'Use advanced options for more controls.',
                      style: TextStyle(color: lim.textDim),),),
            _HarnessTabPane(
                fields: fields,
                controllers: _fieldControllers,
                saving: _saving,
                onSave: _saveHarnessField,
                showTabContext: searchActive || _selected == 'advanced',
                tabTitleFor: (f) =>
                    snap?.tabs.where((t) => t.id == f.tabId).firstOrNull?.title,
                collapseGroups: !searchActive && _selected == 'advanced',),
            if (_selected == 'session_ui' &&
                !searchActive &&
                LiminalFeatureFlags.desktopAppsEnabled) ...[
              const SizedBox(height: 24),
              ExpansionTile(
                  title: const Text('Desktop widgets'), children: [apps],),
            ],
            const SizedBox(height: 16),
            Text(
                'Switches save immediately. Use Apply for text and selection changes.',
                style: TextStyle(color: lim.textDim, fontSize: 12),),
          ],
        ],),
      ),
    );
  }

  PreferredSizeWidget _appBar(BuildContext context) {
    return AppBar(
      toolbarHeight: 72,
      title: const Text('Workspace / Settings'),
      leading: IconButton(
        icon: const Icon(Icons.arrow_back),
        onPressed: () => context.pop(),
      ),
    );
  }
}

class _VireonAccountPanel extends StatelessWidget {
  const _VireonAccountPanel({
    required this.snapshot,
    required this.loading,
    required this.busy,
    required this.onSignIn,
    required this.onSignOut,
    this.error,
  });

  final VireonAccountSnapshot snapshot;
  final bool loading;
  final bool busy;
  final String? error;
  final VoidCallback onSignIn;
  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);

    if (loading && !snapshot.connected) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: LiminalSpacing.md),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (snapshot.connected) ...[
          _StatusRow(
            label: 'Signed in',
            value: [
              if (snapshot.email != null && snapshot.email!.isNotEmpty)
                snapshot.email!,
              if (snapshot.tier.isNotEmpty) '(${snapshot.tier})',
            ].join(' '),
            ok: true,
          ),
          if (snapshot.licensed)
            Padding(
              padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
              child: Text(
                'License active — stored locally in ~/.liminal/',
                style:
                    theme.textTheme.bodyMedium?.copyWith(color: lim.textMuted),
              ),
            ),
        ] else
          Padding(
            padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
            child: Text(
              'Not signed in. Use your Vireon account to unlock Pro, Team, and Enterprise features.',
              style: theme.textTheme.bodyMedium?.copyWith(
                color: lim.textMuted,
                height: 1.45,
              ),
            ),
          ),
        if (error != null && error!.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(bottom: LiminalSpacing.sm),
            child:
                Text(error!, style: TextStyle(color: theme.colorScheme.error)),
          ),
        Wrap(
          spacing: LiminalSpacing.sm,
          runSpacing: LiminalSpacing.sm,
          children: [
            if (!snapshot.connected)
              FilledButton(
                onPressed: busy ? null : onSignIn,
                child: busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Sign in to Vireon'),
              )
            else
              OutlinedButton(
                onPressed: busy ? null : onSignOut,
                child: busy
                    ? const SizedBox(
                        width: 22,
                        height: 22,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Text('Sign out'),
              ),
          ],
        ),
        if (busy && !snapshot.connected)
          Padding(
            padding: const EdgeInsets.only(top: LiminalSpacing.sm),
            child: Text(
              'Complete sign-in in your browser, then return here.',
              style: theme.textTheme.bodySmall?.copyWith(color: lim.accent),
            ),
          ),
      ],
    );
  }
}

class _ProviderForm extends StatelessWidget {
  const _ProviderForm({
    required this.apiKey,
    required this.model,
    required this.baseUrl,
    required this.cfg,
    required this.presets,
    required this.backends,
    required this.saving,
    required this.onSave,
    required this.onPresetApply,
    this.provider,
    this.singleModel = false,
  });

  final TextEditingController apiKey;
  final TextEditingController model;
  final TextEditingController baseUrl;
  final AppConfig? cfg;
  final HarnessSettingsProvider? provider;
  final bool singleModel;
  final List<ProviderPreset> presets;
  final List<ProviderBackend> backends;
  final bool saving;
  final VoidCallback onSave;
  final Future<void> Function(String presetId) onPresetApply;

  String _resolveBackendId() {
    final b = baseUrl.text.trim().replaceAll(RegExp(r'/+$'), '');
    if (b.isEmpty && provider?.resolvedBackendId.isNotEmpty == true) {
      return provider!.resolvedBackendId;
    }
    if (b.contains('llm.cast.ai') || b.contains('llm.kimchi.dev')) {
      return 'kimchi';
    }
    if (b.contains('localhost') || b.contains('127.0.0.1')) {
      return 'local';
    }
    return 'openrouter';
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final presetLocked = provider?.presetLockedByEnv ?? false;
    final resolvedBackendId = _resolveBackendId();
    final backendPresets =
        ProviderPreset.forBackend(presets, resolvedBackendId);
    final resolvedPresetId = presets.isEmpty
        ? 'custom'
        : ProviderPreset.resolveSelection(presets, model.text, baseUrl.text);
    final modelDropdownValue =
        backendPresets.any((p) => p.id == resolvedPresetId)
            ? resolvedPresetId
            : 'custom';
    String? presetHint;
    for (final p in presets) {
      if (p.id == resolvedPresetId) {
        presetHint = p.hint;
        break;
      }
    }
    String? backendHint;
    for (final b in backends) {
      if (b.id == resolvedBackendId) {
        backendHint = b.hint;
        break;
      }
    }

    return LayoutBuilder(
      builder: (context, constraints) {
        final twoCol = constraints.maxWidth >= LiminalBreakpoints.medium;

        final modelField = LiminalTextField(
          controller: model,
          label: 'Model',
          enabled: !(cfg?.modelLockedByEnv ?? false),
          helper: cfg?.modelLockedByEnv == true
              ? 'Locked by AGENT_MODEL in .env'
              : null,
        );
        final baseUrlField = LiminalTextField(
          controller: baseUrl,
          label: 'API base URL',
          enabled: !(cfg?.baseUrlLockedByEnv ?? false),
          helper: cfg?.baseUrlLockedByEnv == true
              ? 'Locked by AGENT_API_BASE_URL in .env'
              : null,
        );

        return Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _StatusRow(
              label: 'API key',
              value: cfg?.apiKeyConfigured == true
                  ? 'Configured'
                  : 'Not configured',
              ok: cfg?.apiKeyConfigured == true,
            ),
            if (backends.isNotEmpty) ...[
              Text(
                'Provider',
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: LiminalSpacing.xs),
              DropdownButtonFormField<String>(
                isExpanded: true,
                value: backends.any((b) => b.id == resolvedBackendId)
                    ? resolvedBackendId
                    : backends.first.id,
                decoration: InputDecoration(
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: lim.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: lim.border),
                  ),
                ),
                dropdownColor: lim.panel,
                style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
                items: [
                  for (final b in backends)
                    DropdownMenuItem(
                      value: b.id,
                      child: Text(b.label, overflow: TextOverflow.ellipsis),
                    ),
                ],
                onChanged: (presetLocked || saving)
                    ? null
                    : (backendId) {
                        if (backendId == null) return;
                        final backend = backends.where((b) => b.id == backendId).firstOrNull;
                        if (backend != null) { baseUrl.text = backend.baseURL; onSave(); }
                      },
              ),
              if (backendHint != null && backendHint.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: LiminalSpacing.xs),
                  child: Text(
                    backendHint,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: lim.textMuted,
                      height: 1.45,
                    ),
                  ),
                ),
              const SizedBox(height: LiminalSpacing.md),
            ],
            if (resolvedBackendId == 'openrouter') ValueListenableBuilder<TextEditingValue>(
              valueListenable: model, builder: (context, value, _) => OpenRouterModelPicker(
                value: value.text, enabled: !saving, singleModel: singleModel,
                load: AppScope.of(context).loadOpenRouterModels,
                onChanged: (id) { model.text = id; onSave(); },
              ),
            ),
            if (resolvedBackendId != 'openrouter' && backendPresets.isNotEmpty && !singleModel) ...[
              Text(
                'Model',
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: LiminalSpacing.xs),
              DropdownButtonFormField<String>(
                isExpanded: true,
                value: modelDropdownValue,
                decoration: InputDecoration(
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: lim.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(10),
                    borderSide: BorderSide(color: lim.border),
                  ),
                ),
                dropdownColor: lim.panel,
                style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
                items: [
                  for (final p in backendPresets)
                    DropdownMenuItem(
                      value: p.id,
                      child: Text(p.label, overflow: TextOverflow.ellipsis),
                    ),
                  const DropdownMenuItem(
                    value: 'custom',
                    child: Text('Custom…', overflow: TextOverflow.ellipsis),
                  ),
                ],
                onChanged: (presetLocked || saving)
                    ? null
                    : (id) {
                        if (id == null || id == 'custom') return;
                        onPresetApply(id);
                      },
              ),
              if (presetLocked)
                Padding(
                  padding: const EdgeInsets.only(top: LiminalSpacing.xs),
                  child: Text(
                    'Presets disabled — model or base URL is locked by process env (.env).',
                    style: theme.textTheme.bodySmall?.copyWith(color: lim.warn),
                  ),
                )
              else
                Padding(
                  padding: const EdgeInsets.only(top: LiminalSpacing.xs),
                  child: Text(
                    'Choosing a preset saves the model configuration immediately.',
                    style: theme.textTheme.bodySmall
                        ?.copyWith(color: lim.textMuted),
                  ),
                ),
              if (presetHint != null && presetHint.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(
                    top: LiminalSpacing.xs,
                    bottom: LiminalSpacing.md,
                  ),
                  child: Text(
                    presetHint,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: lim.textMuted,
                      height: 1.45,
                    ),
                  ),
                )
              else
                const SizedBox(height: LiminalSpacing.md),
            ],
            ExpansionTile(
              title: const Text('Credentials & custom connection'),
              subtitle: const Text(
                  'Change your API key, model ID, or server address.',),
              tilePadding: EdgeInsets.zero,
              children: [
                LiminalTextField(
                  controller: apiKey,
                  label: 'New API key',
                  hint:
                      'Optional — keys in .env (KIMCHI_API_KEY, OPENROUTER_API_KEY) load automatically',
                  obscure: true,
                ),
                if (twoCol)
                  Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Expanded(child: modelField),
                      const SizedBox(width: LiminalSpacing.md),
                      Expanded(child: baseUrlField),
                    ],
                  )
                else ...[
                  modelField,
                  baseUrlField,
                ],
                const SizedBox(height: LiminalSpacing.sm),
                Align(
                  alignment: Alignment.centerLeft,
                  child: FilledButton(
                    onPressed: saving ? null : onSave,
                    child: saving
                        ? const SizedBox(
                            height: 22,
                            width: 22,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Save provider'),
                  ),
                ),
              ],
            ),
          ],
        );
      },
    );
  }
}

class _StatusRow extends StatelessWidget {
  const _StatusRow({
    required this.label,
    required this.value,
    required this.ok,
  });

  final String label;
  final String value;
  final bool ok;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    return Padding(
      padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(label, style: Theme.of(context).textTheme.titleSmall),
                const SizedBox(height: 2),
                Text(value, style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
          Icon(
            ok ? Icons.check_circle : Icons.warning_amber_rounded,
            color: ok ? lim.success : lim.warn,
          ),
        ],
      ),
    );
  }
}

LinkedHashMap<String, List<HarnessSettingsField>> _groupBySubgroup(
  List<HarnessSettingsField> fields,
) {
  final order = <String>[];
  final map = <String, List<HarnessSettingsField>>{};
  for (final f in fields) {
    final label = f.key == 'AGENT_EFFORT' || f.key == 'AGENT_TTS_ENABLED'
        ? 'Response & voice'
        : f.subgroupLabel.isNotEmpty
        ? f.subgroupLabel
        : (f.subgroupId.isNotEmpty ? f.subgroupId : '');
    if (!map.containsKey(label)) {
      order.add(label);
      map[label] = [];
    }
    map[label]!.add(f);
  }
  return LinkedHashMap.fromEntries(order.map((k) => MapEntry(k, map[k]!)));
}

bool harnessFieldMatchesSearch(HarnessSettingsField field, String query) {
  if (query.isEmpty) return true;
  final haystack = [
    field.label,
    field.key,
    field.description ?? '',
    field.subgroupLabel,
    field.subgroupId,
  ].join('\n').toLowerCase();
  return haystack.contains(query);
}

LinkedHashMap<String, List<HarnessSettingsField>> _groupByTabThenSubgroup(
  List<HarnessSettingsField> fields,
  String? Function(HarnessSettingsField field) tabTitleFor,
) {
  final tabOrder = <String>[];
  final tabMap = <String, List<HarnessSettingsField>>{};
  for (final f in fields) {
    final tab = tabTitleFor(f)?.trim();
    final tabLabel = tab != null && tab.isNotEmpty ? tab : 'Other';
    tabMap.putIfAbsent(tabLabel, () {
      tabOrder.add(tabLabel);
      return [];
    });
    tabMap[tabLabel]!.add(f);
  }
  final out = LinkedHashMap<String, List<HarnessSettingsField>>();
  for (final tab in tabOrder) {
    for (final entry in _groupBySubgroup(tabMap[tab]!).entries) {
      final key = entry.key.isEmpty ? tab : '$tab · ${entry.key}';
      out[key] = entry.value;
    }
  }
  return out;
}

class _HarnessTabPane extends StatelessWidget {
  const _HarnessTabPane(
      {required this.fields,
      required this.controllers,
      required this.saving,
      required this.onSave,
      this.showTabContext = false,
      this.tabTitleFor,
      this.collapseGroups = false,});
  final List<HarnessSettingsField> fields;
  final Map<String, TextEditingController> controllers;
  final bool saving;
  final void Function(HarnessSettingsField, String) onSave;
  final bool showTabContext;
  final String? Function(HarnessSettingsField)? tabTitleFor;
  final bool collapseGroups;
  @override
  Widget build(BuildContext context) {
    final groups = showTabContext && tabTitleFor != null
        ? _groupByTabThenSubgroup(fields, tabTitleFor!)
        : _groupBySubgroup(fields);
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      for (final entry in groups.entries)
        Padding(
            padding: const EdgeInsets.only(top: 16),
            child: collapseGroups
                ? ExpansionTile(
                    key: PageStorageKey(entry.key),
                    title: Text(entry.key),
                    subtitle: Text('${entry.value.length} options'),
                    children: [_rows(entry.value)],)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                        if (entry.key.isNotEmpty)
                          Padding(
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Text(entry.key,
                                  style:
                                      Theme.of(context).textTheme.titleMedium,),),
                        _rows(entry.value),
                      ],),),
    ],);
  }

  Widget _rows(List<HarnessSettingsField> rows) => Column(children: [
        for (final f in rows)
          Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: LiminalHarnessField(
                  key: ValueKey(f.key),
                  field: f,
                  controller: controllers[f.key],
                  enabled: !saving,
                  onApply: (v) => onSave(f, v),),),
      ],);
}

class _DesktopAppsPanel extends StatefulWidget {
  const _DesktopAppsPanel({
    required this.apps,
    required this.caches,
    required this.loading,
    required this.onOpen,
    required this.onRemove,
    required this.onRefresh,
    required this.onUpdate,
  });

  final List<LiminalAppSpec> apps;
  final Map<String, AppCacheEntry> caches;
  final bool loading;
  final Future<bool> Function(String id) onOpen;
  final Future<bool> Function(String id) onRemove;
  final Future<bool> Function(String id) onRefresh;
  final Future<bool> Function(
    String id,
    Map<String, dynamic>? props,
    bool? autoOpen,
  ) onUpdate;

  @override
  State<_DesktopAppsPanel> createState() => _DesktopAppsPanelState();
}

class _DesktopAppsPanelState extends State<_DesktopAppsPanel> {
  String? _busyId;

  String _formatUpdated(AppCacheEntry? cache) {
    if (cache == null) return 'Never refreshed';
    final dt = DateTime.fromMillisecondsSinceEpoch(cache.fetchedAt);
    final local = dt.toLocal();
    final h = local.hour.toString().padLeft(2, '0');
    final m = local.minute.toString().padLeft(2, '0');
    return cache.ok ? 'Updated $h:$m' : 'Error · $h:$m';
  }

  @override
  Widget build(BuildContext context) {
    if (widget.loading && widget.apps.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }
    if (widget.apps.isEmpty) {
      return Text(
        'No desktop apps yet. Ask the agent to spawn one (e.g. weather for your city).',
        style: Theme.of(context).textTheme.bodyMedium,
      );
    }

    return Column(
      children: [
        for (final app in widget.apps) ...[
          Card(
            margin: const EdgeInsets.only(bottom: LiminalSpacing.sm),
            child: Padding(
              padding: const EdgeInsets.all(LiminalSpacing.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              app.title,
                              style: Theme.of(context).textTheme.titleSmall,
                            ),
                            Text(
                              '${app.type} · ${_formatUpdated(widget.caches[app.id])}',
                              style: Theme.of(context).textTheme.bodySmall,
                            ),
                          ],
                        ),
                      ),
                      if (_busyId == app.id)
                        const SizedBox(
                          width: 20,
                          height: 20,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                    ],
                  ),
                  if (app.type == 'weather') ...[
                    const SizedBox(height: LiminalSpacing.sm),
                    _WeatherAppEditor(
                      app: app,
                      enabled: _busyId == null,
                      onSave: (location, units, autoOpen) async {
                        setState(() => _busyId = app.id);
                        final ok = await widget.onUpdate(
                          app.id,
                          {
                            'location': location,
                            'units': units,
                          },
                          autoOpen,
                        );
                        if (mounted) setState(() => _busyId = null);
                        return ok;
                      },
                    ),
                  ],
                  if (app.type == 'html' || app.type == 'markdown') ...[
                    const SizedBox(height: LiminalSpacing.sm),
                    _WidgetContentEditor(
                      app: app,
                      enabled: _busyId == null,
                      onSave: (props, autoOpen) async {
                        setState(() => _busyId = app.id);
                        final ok =
                            await widget.onUpdate(app.id, props, autoOpen);
                        if (mounted) setState(() => _busyId = null);
                        return ok;
                      },
                    ),
                  ],
                  const SizedBox(height: LiminalSpacing.sm),
                  Wrap(
                    spacing: 8,
                    runSpacing: 4,
                    children: [
                      FilledButton.tonal(
                        onPressed: _busyId != null
                            ? null
                            : () async {
                                setState(() => _busyId = app.id);
                                await widget.onOpen(app.id);
                                if (mounted) setState(() => _busyId = null);
                              },
                        child: const Text('Open'),
                      ),
                      OutlinedButton(
                        onPressed: _busyId != null
                            ? null
                            : () async {
                                setState(() => _busyId = app.id);
                                await widget.onRefresh(app.id);
                                if (mounted) setState(() => _busyId = null);
                              },
                        child: const Text('Refresh'),
                      ),
                      TextButton(
                        onPressed: _busyId != null
                            ? null
                            : () async {
                                setState(() => _busyId = app.id);
                                await widget.onRemove(app.id);
                                if (mounted) setState(() => _busyId = null);
                              },
                        child: const Text('Remove'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ],
    );
  }
}

class _WeatherAppEditor extends StatefulWidget {
  const _WeatherAppEditor({
    required this.app,
    required this.enabled,
    required this.onSave,
  });

  final LiminalAppSpec app;
  final bool enabled;
  final Future<bool> Function(String location, String units, bool autoOpen)
      onSave;

  @override
  State<_WeatherAppEditor> createState() => _WeatherAppEditorState();
}

class _WeatherAppEditorState extends State<_WeatherAppEditor> {
  late final TextEditingController _location;
  late String _units;
  late bool _autoOpen;

  @override
  void initState() {
    super.initState();
    _location = TextEditingController(
      text: widget.app.props['location'] as String? ?? '',
    );
    _units = widget.app.props['units'] as String? ?? 'metric';
    _autoOpen = widget.app.autoOpen;
  }

  @override
  void didUpdateWidget(covariant _WeatherAppEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.app.id != widget.app.id) {
      _location.text = widget.app.props['location'] as String? ?? '';
      _units = widget.app.props['units'] as String? ?? 'metric';
      _autoOpen = widget.app.autoOpen;
    }
  }

  @override
  void dispose() {
    _location.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _location,
          enabled: widget.enabled,
          decoration: const InputDecoration(
            labelText: 'Location',
            border: OutlineInputBorder(),
          ),
        ),
        const SizedBox(height: LiminalSpacing.sm),
        DropdownButtonFormField<String>(
          value: _units,
          decoration: const InputDecoration(labelText: 'Units'),
          items: const [
            DropdownMenuItem(value: 'metric', child: Text('Metric')),
            DropdownMenuItem(value: 'imperial', child: Text('Imperial')),
          ],
          onChanged: widget.enabled
              ? (v) {
                  if (v != null) setState(() => _units = v);
                }
              : null,
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Open at startup'),
          value: _autoOpen,
          onChanged:
              widget.enabled ? (v) => setState(() => _autoOpen = v) : null,
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: widget.enabled
                ? () async {
                    await widget.onSave(
                      _location.text.trim(),
                      _units,
                      _autoOpen,
                    );
                  }
                : null,
            child: const Text('Save'),
          ),
        ),
      ],
    );
  }
}

class _WidgetContentEditor extends StatefulWidget {
  const _WidgetContentEditor({
    required this.app,
    required this.enabled,
    required this.onSave,
  });

  final LiminalAppSpec app;
  final bool enabled;
  final Future<bool> Function(Map<String, dynamic> props, bool autoOpen) onSave;

  @override
  State<_WidgetContentEditor> createState() => _WidgetContentEditorState();
}

class _WidgetContentEditorState extends State<_WidgetContentEditor> {
  late final TextEditingController _content;
  late bool _autoOpen;

  String get _fieldKey => widget.app.type == 'markdown' ? 'markdown' : 'html';

  @override
  void initState() {
    super.initState();
    final props = widget.app.props;
    final stored = props[_fieldKey] as String? ?? '';
    final ref = props['html_ref'] as String?;
    _content = TextEditingController(
      text: stored.isNotEmpty
          ? stored
          : (ref != null ? '(content stored on disk: $ref)' : ''),
    );
    _autoOpen = widget.app.autoOpen;
  }

  @override
  void didUpdateWidget(covariant _WidgetContentEditor oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.app.id != widget.app.id) {
      final props = widget.app.props;
      _content.text = props[_fieldKey] as String? ?? '';
      _autoOpen = widget.app.autoOpen;
    }
  }

  @override
  void dispose() {
    _content.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final label = widget.app.type == 'markdown' ? 'Markdown' : 'HTML body';
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: _content,
          enabled: widget.enabled,
          maxLines: 6,
          decoration: InputDecoration(
            labelText: label,
            border: const OutlineInputBorder(),
            helperText: widget.app.type == 'html'
                ? 'Saved HTML opens in the desktop widget window.'
                : null,
          ),
        ),
        SwitchListTile(
          contentPadding: EdgeInsets.zero,
          title: const Text('Open at startup'),
          value: _autoOpen,
          onChanged:
              widget.enabled ? (v) => setState(() => _autoOpen = v) : null,
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: widget.enabled &&
                    !_content.text.startsWith('(content stored')
                ? () async {
                    await widget.onSave({_fieldKey: _content.text}, _autoOpen);
                  }
                : null,
            child: const Text('Save'),
          ),
        ),
      ],
    );
  }
}
