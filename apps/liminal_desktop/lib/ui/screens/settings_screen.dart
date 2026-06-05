import 'dart:collection';

import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../../app/app_scope.dart';
import '../../models/app_config.dart';
import '../../models/harness_settings.dart';
import '../../models/vireon_account.dart';
import '../layout/liminal_breakpoints.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../widgets/liminal_form_field.dart';
import '../widgets/liminal_page_canvas.dart';
import '../widgets/liminal_section.dart';
import '../widgets/liminal_shell.dart';

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
  TabController? _tabs;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final cfg = AppScope.of(context).config;
      if (cfg != null) {
        _model.text = cfg.providerModel;
        _baseUrl.text = cfg.providerBaseUrl;
      }
      await Future.wait([
        AppScope.of(context).loadHarnessSettings(),
        AppScope.of(context).loadVireonAccount(),
      ]);
      if (mounted) _syncFieldControllers();
    });
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

  @override
  void dispose() {
    _tabs?.dispose();
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
                            if (mounted && !ok) {
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
                  SliverPadding(
                    padding: const EdgeInsets.only(top: LiminalSpacing.lg),
                    sliver: SliverToBoxAdapter(
                      child: LiminalSection(
                        title: 'Provider',
                        subtitle:
                            'API keys live in `.env` only — never sent over the socket.',
                        child: _ProviderForm(
                          apiKey: _apiKey,
                          model: _model,
                          baseUrl: _baseUrl,
                          cfg: cfg,
                          provider: snap?.provider,
                          presets: snap?.providerPresets ?? const [],
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
                    SliverFillRemaining(
                      hasScrollBody: true,
                      child: TabBarView(
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
  final bool saving;
  final VoidCallback onSave;
  final Future<void> Function(String presetId) onPresetApply;

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final presetLocked = provider?.presetLockedByEnv ?? false;
    final resolvedPresetId = presets.isEmpty
        ? 'custom'
        : ProviderPreset.resolveSelection(presets, model.text, baseUrl.text);
    String? presetHint;
    for (final p in presets) {
      if (p.id == resolvedPresetId) {
        presetHint = p.hint;
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
              hint: 'Leave blank to keep current',
              obscure: true,
            ),
            if (presets.isNotEmpty) ...[
              Text(
                'Preset',
                style: theme.textTheme.titleSmall,
              ),
              const SizedBox(height: LiminalSpacing.xs),
              DropdownButtonFormField<String>(
                value: presets.any((p) => p.id == resolvedPresetId)
                    ? resolvedPresetId
                    : 'custom',
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
                  for (final p in presets)
                    DropdownMenuItem(
                      value: p.id,
                      child: Text(p.label, overflow: TextOverflow.ellipsis),
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

class _HarnessTabPane extends StatelessWidget {
  const _HarnessTabPane({
    required this.fields,
    required this.controllers,
    required this.saving,
    required this.onSave,
  });

  final List<HarnessSettingsField> fields;
  final Map<String, TextEditingController> controllers;
  final bool saving;
  final void Function(HarnessSettingsField field, String value) onSave;

  @override
  Widget build(BuildContext context) {
    if (fields.isEmpty) {
      return const Center(child: Text('No settings in this tab.'));
    }

    final groups = _groupBySubgroup(fields);
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
