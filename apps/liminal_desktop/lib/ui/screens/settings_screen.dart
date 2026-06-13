import 'dart:collection';

import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../core/feature_flags.dart';
import '../../models/app_config.dart';
import '../../models/harness_settings.dart';
import '../../models/managed_model_family.dart';
import '../../models/liminal_app_spec.dart';
import '../../models/vireon_account.dart';
import '../layout/liminal_breakpoints.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../design_system/liminal_design_system.dart';
import '../widgets/liminal_form_field.dart';
import '../widgets/liminal_page_canvas.dart';
import '../widgets/liminal_shell.dart';
import '../widgets/managed_inference_panel.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen>
    with SingleTickerProviderStateMixin {
  final _apiKey = TextEditingController();
  final _model = TextEditingController();
  final _baseUrl = TextEditingController();
  final Map<String, TextEditingController> _fieldControllers = {};
  final _search = TextEditingController();
  TabController? _tabs;
  bool _saving = false;
  String? _error;

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
        AppScope.of(context).loadHarnessSettings(reconnectVireon: true),
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

  String _managedProviderPref(HarnessSettingsSnapshot? snap) {
    if (snap == null) return 'auto';
    for (final f in snap.fields) {
      if (f.key == 'AGENT_MANAGED_PROVIDER') {
        final v = f.value.trim().toLowerCase();
        if (v == 'bedrock' || v == 'openrouter') return v;
        return 'auto';
      }
    }
    return 'auto';
  }

  String _resolveManagedModelId(String modelOrCatalogId, HarnessSettingsSnapshot? snap) {
    final catalog = AppScope.of(context).managedInferenceModels;
    final pref = _managedProviderPref(snap);
    if (catalog == null) return modelOrCatalogId;
    final row = findManagedCatalogRowByModelId(catalog.models, modelOrCatalogId);
    if (row == null) return modelOrCatalogId;
    return resolveModelIdForManagedProvider(row.id, pref, row.providers);
  }

  Future<void> _onManagedMainModel(String modelId) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final snap = AppScope.of(context).harnessSettings;
    final resolved = _resolveManagedModelId(modelId, snap);
    final ok = await AppScope.of(context).patchManagedInferenceModels(mainModel: resolved);
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
    final snap = AppScope.of(context).harnessSettings;
    final resolved = _resolveManagedModelId(modelId, snap);
    final ok = await AppScope.of(context).patchManagedInferenceModels(fastModel: resolved);
    if (!mounted) return;
    if (!ok) _error = 'Failed to update fast model';
    setState(() => _saving = false);
  }

  Future<void> _onManagedProvider(String provider) async {
    setState(() {
      _saving = true;
      _error = null;
    });
    final catalog = AppScope.of(context).managedInferenceModels;
    final snap = AppScope.of(context).harnessSettings;
    final main = snap?.provider.model.trim() ?? '';
    final fast = _fastModelFromSnapshot(snap);
    final models = catalog?.models ?? const <ManagedInferenceModel>[];
    final remappedMain = remapManagedModelIdForProvider(main, provider, models);
    final remappedFast = remapManagedModelIdForProvider(fast, provider, models);
    final ok = await AppScope.of(context).patchManagedInferenceModels(
      managedProvider: provider,
      mainModel: remappedMain,
      fastModel: remappedFast,
    );
    if (!mounted) return;
    if (ok) {
      _syncProviderControllersFromHost();
      _syncFieldControllers();
    } else {
      _error = 'Failed to update managed provider';
    }
    setState(() => _saving = false);
  }

  void _syncFieldControllers() {
    final snap = AppScope.of(context).harnessSettings;
    if (snap == null) return;
    for (final f in snap.fields) {
      if (f.valueKind == 'boolean' || f.valueKind == 'enum') continue;
      _fieldControllers.putIfAbsent(f.key, () => TextEditingController(text: f.value));
    }
    if (_tabs == null && snap.tabs.isNotEmpty) {
      _tabs = TabController(length: snap.tabs.length, vsync: this);
      setState(() {});
    } else if (_tabs != null) {
      setState(() {});
    }
  }

  void _onSearchChanged() {
    if (mounted) setState(() {});
  }

  @override
  void dispose() {
    _search.removeListener(_onSearchChanged);
    _tabs?.dispose();
    _search.dispose();
    _apiKey.dispose();
    _model.dispose();
    _baseUrl.dispose();
    for (final c in _fieldControllers.values) {
      c.dispose();
    }
    super.dispose();
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
        _error = AppScope.of(context).setupError ?? 'Failed to apply provider preset';
      }
    });
  }

  Future<void> _saveProvider() async {
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

  Future<void> _saveHarnessField(HarnessSettingsField field, String value) async {
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
    final searchQ = _search.text.trim().toLowerCase();
    final harnessSearchActive = searchQ.isNotEmpty;
    final filteredHarnessFields = harnessSearchActive && snap != null
        ? snap.fields.where((f) => harnessFieldMatchesSearch(f, searchQ)).toList()
        : null;

    if (host.harnessSettingsLoading && snap == null) {
      return LiminalShell(
        appBar: _appBar(context),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    return LiminalShell(
      appBar: _appBar(context),
      body: LiminalPageCanvas(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Expanded(
              child: CustomScrollView(
                slivers: [
                  SliverPadding(
                    padding: const EdgeInsets.only(top: LiminalSpacing.lg),
                    sliver: SliverToBoxAdapter(
                      child: LiminalSection(
                        title: 'Vireon account',
                        subtitle:
                            'Sign in for Pro managed inference, cloud sync, and team features. '
                            'Community Edition works without an account.',
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
                      ),
                    ),
                  ),
                  if (LiminalFeatureFlags.desktopAppsEnabled)
                    SliverPadding(
                      padding: const EdgeInsets.only(top: LiminalSpacing.lg),
                      sliver: SliverToBoxAdapter(
                        child: LiminalSection(
                          title: 'Desktop apps',
                          subtitle:
                              'Separate OS windows spawned by the agent or opened from here. '
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
                        ),
                      ),
                    ),
                  SliverPadding(
                    padding: const EdgeInsets.only(top: LiminalSpacing.lg),
                    sliver: SliverToBoxAdapter(
                      child: LiminalSection(
                        title: 'Workspace',
                        subtitle:
                            'New chats can start in a scratch folder, a folder you pick, or this default project directory.',
                        child: _DefaultWorkspacePanel(
                          folderPath: cfg?.defaultWorkspaceFolder,
                          saving: _saving,
                          onPick: () async {
                            final picked = await FilePicker.platform.getDirectoryPath(
                              dialogTitle: 'Default workspace folder',
                            );
                            if (picked == null || !mounted) return;
                            setState(() => _saving = true);
                            final ok = await AppScope.of(context)
                                .setDefaultWorkspaceFolder(picked);
                            if (mounted) setState(() => _saving = false);
                            if (!ok && mounted) {
                              setState(() => _error = 'Could not save default workspace');
                            }
                          },
                          onClear: () async {
                            setState(() => _saving = true);
                            final ok = await AppScope.of(context)
                                .setDefaultWorkspaceFolder(null);
                            if (mounted) setState(() => _saving = false);
                            if (!ok && mounted) {
                              setState(() => _error = 'Could not clear default workspace');
                            }
                          },
                        ),
                      ),
                    ),
                  ),
                  SliverPadding(
                    padding: const EdgeInsets.only(top: LiminalSpacing.lg),
                    sliver: SliverToBoxAdapter(
                      child: LiminalSection(
                        title: 'Provider',
                        subtitle: snap?.provider.showManagedInference == true
                            ? 'Pro managed inference — hybrid Bedrock + OpenRouter via Vireon.'
                            : 'API keys live in `.env` only — never sent over the socket.',
                        child: snap?.provider.showManagedInference == true
                            ? ManagedInferencePanel(
                                mainModel: snap!.provider.model,
                                fastModel: _fastModelFromSnapshot(snap),
                                managedProvider: _managedProviderPref(snap),
                                catalog: host.managedInferenceModels,
                                loading: host.managedInferenceModelsLoading,
                                error: host.managedInferenceModelsError,
                                saving: _saving,
                                onMainModel: _onManagedMainModel,
                                onFastModel: _onManagedFastModel,
                                onManagedProvider: _onManagedProvider,
                              )
                            : _ProviderForm(
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
                      ),
                    ),
                  ),
                  if (snap != null && snap.tabs.isNotEmpty && _tabs != null) ...[
                    SliverPadding(
                      padding: const EdgeInsets.only(
                        top: LiminalSpacing.xl,
                        bottom: LiminalSpacing.sm,
                      ),
                      sliver: SliverToBoxAdapter(
                        child: Text(
                          'Harness',
                          style: Theme.of(context).textTheme.titleLarge?.copyWith(
                                color: lim.accent,
                                fontWeight: FontWeight.w600,
                              ),
                        ),
                      ),
                    ),
                    if (snap.hint != null && snap.hint!.trim().isNotEmpty)
                      SliverPadding(
                        padding: const EdgeInsets.only(bottom: LiminalSpacing.sm),
                        sliver: SliverToBoxAdapter(
                          child: Text(
                            snap.hint!,
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: lim.textMuted,
                                  height: 1.45,
                                ),
                          ),
                        ),
                      ),
                    SliverPersistentHeader(
                      pinned: true,
                      delegate: _HarnessSearchHeader(
                        search: _search,
                        searchText: _search.text,
                        saving: _saving,
                        background: lim.panel.withValues(alpha: 0.95),
                      ),
                    ),
                    if (!harnessSearchActive)
                      SliverPersistentHeader(
                        pinned: true,
                        delegate: _TabBarHeader(
                          tabBar: TabBar(
                            controller: _tabs,
                            isScrollable: true,
                            tabAlignment: TabAlignment.start,
                            labelStyle: Theme.of(context).textTheme.titleSmall,
                            tabs: [for (final t in snap.tabs) Tab(text: t.title)],
                          ),
                          background: lim.panel.withValues(alpha: 0.95),
                        ),
                      ),
                    if (harnessSearchActive)
                      SliverToBoxAdapter(
                        child: Padding(
                          padding: const EdgeInsets.fromLTRB(
                            LiminalSpacing.md,
                            LiminalSpacing.sm,
                            LiminalSpacing.md,
                            LiminalSpacing.xs,
                          ),
                          child: Text(
                            filteredHarnessFields!.isEmpty
                                ? 'No settings match "$searchQ".'
                                : 'Search results (${filteredHarnessFields.length})',
                            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                                  color: filteredHarnessFields.isEmpty
                                      ? Theme.of(context).colorScheme.error
                                      : lim.warn,
                                ),
                          ),
                        ),
                      ),
                    SliverFillRemaining(
                      hasScrollBody: true,
                      child: harnessSearchActive
                          ? _HarnessTabPane(
                              fields: filteredHarnessFields ?? const [],
                              controllers: _fieldControllers,
                              saving: _saving,
                              onSave: (f, v) => _saveHarnessField(f, v),
                              showTabContext: true,
                              tabTitleFor: (field) {
                                for (final t in snap.tabs) {
                                  if (t.id == field.tabId) return t.title;
                                }
                                return null;
                              },
                            )
                          : TabBarView(
                              controller: _tabs,
                              children: [
                                for (final tab in snap.tabs)
                                  _HarnessTabPane(
                                    fields: snap.fields
                                        .where((f) => f.tabId == tab.id)
                                        .toList(),
                                    controllers: _fieldControllers,
                                    saving: _saving,
                                    onSave: (f, v) => _saveHarnessField(f, v),
                                  ),
                              ],
                            ),
                    ),
                  ] else
                    const SliverPadding(
                      padding: EdgeInsets.only(top: LiminalSpacing.lg),
                      sliver: SliverToBoxAdapter(
                        child: Text('Harness settings unavailable.'),
                      ),
                    ),
                ],
              ),
            ),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(
                  top: LiminalSpacing.sm,
                  bottom: LiminalSpacing.md,
                ),
                child: Text(
                  _error!,
                  style: TextStyle(color: Theme.of(context).colorScheme.error),
                ),
              ),
          ],
        ),
      ),
    );
  }

  PreferredSizeWidget _appBar(BuildContext context) {
    return AppBar(
      title: const Text('Settings'),
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
              if (snapshot.email != null && snapshot.email!.isNotEmpty) snapshot.email!,
              if (snapshot.tier.isNotEmpty) '(${snapshot.tier})',
            ].join(' '),
            ok: true,
          ),
          if (snapshot.licensed)
            Padding(
              padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
              child: Text(
                'License active — stored locally in ~/.liminal/',
                style: theme.textTheme.bodyMedium?.copyWith(color: lim.textMuted),
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
            child: Text(error!, style: TextStyle(color: theme.colorScheme.error)),
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
  });

  final TextEditingController apiKey;
  final TextEditingController model;
  final TextEditingController baseUrl;
  final AppConfig? cfg;
  final HarnessSettingsProvider? provider;
  final List<ProviderPreset> presets;
  final List<ProviderBackend> backends;
  final bool saving;
  final VoidCallback onSave;
  final Future<void> Function(String presetId) onPresetApply;

  String _resolveBackendId() {
    if (provider?.resolvedBackendId.isNotEmpty == true) {
      return provider!.resolvedBackendId;
    }
    final b = baseUrl.text.trim().replaceAll(RegExp(r'/+$'), '');
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
    final modelDropdownValue = backendPresets.any((p) => p.id == resolvedPresetId)
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
            LiminalTextField(
              controller: apiKey,
              label: 'New API key',
              hint: 'Optional — keys in .env (KIMCHI_API_KEY, OPENROUTER_API_KEY) load automatically',
              obscure: true,
            ),
            if (backends.isNotEmpty) ...[
              Text(
                'Provider',
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: LiminalSpacing.xs),
              DropdownButtonFormField<String>(
                value: backends.any((b) => b.id == resolvedBackendId)
                    ? resolvedBackendId
                    : backends.first.id,
                decoration: InputDecoration(
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
                    borderSide: BorderSide(color: lim.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
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
                        final first = ProviderPreset.forBackend(presets, backendId);
                        if (first.isNotEmpty) {
                          onPresetApply(first.first.id);
                        }
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
            if (backendPresets.isNotEmpty) ...[
              Text(
                'Model',
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: LiminalSpacing.xs),
              DropdownButtonFormField<String>(
                value: modelDropdownValue,
                decoration: InputDecoration(
                  isDense: true,
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
                    borderSide: BorderSide(color: lim.border),
                  ),
                  enabledBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(4),
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
                    'Sets main model, base URL, fast model, and provider routing. '
                    'Saved to runtime prefs immediately.',
                    style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted),
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
    final label = f.subgroupLabel.isNotEmpty
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
  const _HarnessTabPane({
    required this.fields,
    required this.controllers,
    required this.saving,
    required this.onSave,
    this.showTabContext = false,
    this.tabTitleFor,
  });

  final List<HarnessSettingsField> fields;
  final Map<String, TextEditingController> controllers;
  final bool saving;
  final void Function(HarnessSettingsField field, String value) onSave;
  final bool showTabContext;
  final String? Function(HarnessSettingsField field)? tabTitleFor;

  @override
  Widget build(BuildContext context) {
    if (fields.isEmpty) {
      return const Center(child: Text('No settings in this tab.'));
    }

    final groups = showTabContext && tabTitleFor != null
        ? _groupByTabThenSubgroup(fields, tabTitleFor!)
        : _groupBySubgroup(fields);
    final lim = LiminalTheme.of(context);

    return LayoutBuilder(
      builder: (context, constraints) {
        final columns = LiminalBreakpoints.settingsColumns(constraints.maxWidth);

        return ListView(
          padding: const EdgeInsets.symmetric(vertical: LiminalSpacing.md),
          children: [
            for (final entry in groups.entries) ...[
              if (entry.key.isNotEmpty) ...[
                Padding(
                  padding: const EdgeInsets.only(
                    top: LiminalSpacing.md,
                    bottom: LiminalSpacing.sm,
                  ),
                  child: Text(
                    entry.key,
                    style: Theme.of(context).textTheme.titleMedium?.copyWith(
                          color: lim.text,
                          fontWeight: FontWeight.w600,
                        ),
                  ),
                ),
              ],
              if (columns == 1)
                for (final f in entry.value)
                  Padding(
                    padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
                    child: _fieldTile(f),
                  )
              else
                for (var i = 0; i < entry.value.length; i += 2)
                  Padding(
                    padding: const EdgeInsets.only(bottom: LiminalSpacing.md),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Expanded(child: _fieldTile(entry.value[i])),
                        const SizedBox(width: LiminalSpacing.md),
                        if (i + 1 < entry.value.length)
                          Expanded(child: _fieldTile(entry.value[i + 1]))
                        else
                          const Expanded(child: SizedBox.shrink()),
                      ],
                    ),
                  ),
            ],
          ],
        );
      },
    );
  }

  Widget _fieldTile(HarnessSettingsField f) {
    return LiminalHarnessField(
      field: f,
      controller: controllers[f.key],
      enabled: !saving,
      onApply: (v) => onSave(f, v),
    );
  }
}

class _HarnessSearchHeader extends SliverPersistentHeaderDelegate {
  _HarnessSearchHeader({
    required this.search,
    required this.searchText,
    required this.saving,
    required this.background,
  });

  final TextEditingController search;
  final String searchText;
  final bool saving;
  final Color background;

  static const double _height = 56;

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Material(
      color: background,
      child: Padding(
        padding: const EdgeInsets.fromLTRB(
          LiminalSpacing.md,
          LiminalSpacing.xs,
          LiminalSpacing.md,
          LiminalSpacing.sm,
        ),
        child: IgnorePointer(
          ignoring: saving,
          child: Opacity(
            opacity: saving ? 0.6 : 1,
            child: LiminalSearchField(
              controller: search,
              hintText: 'Search settings…',
            ),
          ),
        ),
      ),
    );
  }

  @override
  bool shouldRebuild(covariant _HarnessSearchHeader oldDelegate) =>
      oldDelegate.searchText != searchText ||
      oldDelegate.saving != saving ||
      oldDelegate.background != background;
}

class _TabBarHeader extends SliverPersistentHeaderDelegate {
  _TabBarHeader({required this.tabBar, required this.background});

  final TabBar tabBar;
  final Color background;

  static const double _height = 52;

  @override
  double get minExtent => _height;

  @override
  double get maxExtent => _height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    return Material(
      color: background,
      child: SizedBox(height: _height, child: tabBar),
    );
  }

  @override
  bool shouldRebuild(covariant _TabBarHeader oldDelegate) =>
      oldDelegate.tabBar != tabBar || oldDelegate.background != background;
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
                        final ok = await widget.onUpdate(app.id, props, autoOpen);
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
  final Future<bool> Function(String location, String units, bool autoOpen) onSave;

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
          onChanged: widget.enabled
              ? (v) => setState(() => _autoOpen = v)
              : null,
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
          onChanged: widget.enabled ? (v) => setState(() => _autoOpen = v) : null,
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: widget.enabled && !_content.text.startsWith('(content stored')
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

class _DefaultWorkspacePanel extends StatelessWidget {
  const _DefaultWorkspacePanel({
    required this.folderPath,
    required this.saving,
    required this.onPick,
    required this.onClear,
  });

  final String? folderPath;
  final bool saving;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final path = folderPath?.trim();
    final hasPath = path != null && path.isNotEmpty;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          hasPath
              ? path!
              : 'No default folder — new chats use a scratch workspace unless you pick one.',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: hasPath ? lim.text : lim.textMuted,
                height: 1.45,
              ),
        ),
        const SizedBox(height: LiminalSpacing.md),
        Wrap(
          spacing: LiminalSpacing.sm,
          runSpacing: LiminalSpacing.sm,
          children: [
            FilledButton.icon(
              onPressed: saving ? null : onPick,
              icon: const Icon(Icons.folder_open_outlined, size: 18),
              label: Text(hasPath ? 'Change folder' : 'Choose folder'),
            ),
            if (hasPath)
              OutlinedButton(
                onPressed: saving ? null : onClear,
                child: const Text('Clear default'),
              ),
          ],
        ),
      ],
    );
  }
}
