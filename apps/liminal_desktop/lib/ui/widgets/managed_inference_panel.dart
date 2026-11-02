import '../../models/openrouter_catalog.dart';
import 'openrouter_model_picker.dart';
import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../../models/managed_inference_catalog.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

const _managedProviderOptions = <MapEntry<String, String>>[
  MapEntry('auto', 'Automatic'),
  MapEntry('bedrock', 'AWS Bedrock'),
  MapEntry('openrouter', 'OpenRouter'),
  MapEntry('kimchi', 'Cast AI (Kimchi)'),
];

class ManagedInferencePanel extends StatelessWidget {
  const ManagedInferencePanel({
    super.key,
    required this.mainModel,
    required this.fastModel,
    required this.catalog,
    required this.loading,
    required this.error,
    required this.saving,
    required this.onMainModel,
    required this.onFastModel,
    required this.managedProvider,
    required this.onManagedProvider,
    this.bedrockPresets = const [],
    this.selectedBedrockPresetId = 'custom',
    this.onBedrockPresetApply,
    this.upstream,
    this.singleModel = false,
    this.loadOpenRouter,
  });

  final String mainModel;
  final String fastModel;
  final ManagedInferenceModelsCatalog? catalog;
  final bool loading;
  final String? error;
  final bool saving;
  final String managedProvider;
  final ValueChanged<String> onManagedProvider;
  final ValueChanged<String> onMainModel;
  final ValueChanged<String> onFastModel;
  final List<BedrockModelPreset> bedrockPresets;
  final String selectedBedrockPresetId;
  final ValueChanged<String>? onBedrockPresetApply;
  final String? upstream;
  final bool singleModel;
  final Future<List<OpenRouterCatalogModel>> Function(bool)? loadOpenRouter;

  List<DropdownMenuItem<String>> _modelItems(
    List<ManagedInferenceModel> models,
    List<ManagedInferenceModel> allModels,
    String currentModel,
    String managedProviderPref,
    LiminalTokens lim,
    TextTheme textTheme,
  ) {
    final items = <DropdownMenuItem<String>>[];
    final resolvedCurrent = resolveManagedModelForProviderPreference(
      currentModel,
      allModels,
      managedProviderPref,
    );
    final inList = models.any((m) => m.id == resolvedCurrent);
    if (resolvedCurrent.isNotEmpty && !inList) {
      final label = _labelForModelId(allModels, resolvedCurrent);
      items.add(
        DropdownMenuItem<String>(
          value: resolvedCurrent,
          child: Text(
            'Current: $label',
            overflow: TextOverflow.ellipsis,
            style: textTheme.bodySmall?.copyWith(
              color: lim.text,
              fontFamily: lim.fontFamilyMono,
            ),
          ),
        ),
      );
    }
    final groups = _groupModelsByFamily(models);
    final headerStyle = textTheme.labelSmall?.copyWith(
      color: lim.textMuted,
      fontWeight: FontWeight.w600,
      letterSpacing: 0.4,
    );
    final modelStyle = textTheme.bodySmall?.copyWith(
      color: lim.text,
      fontFamily: lim.fontFamilyMono,
    );

    for (var gi = 0; gi < groups.length; gi++) {
      final entry = groups[gi];
      if (gi > 0) {
        items.add(
          DropdownMenuItem<String>(
            enabled: false,
            value: '__managed_model_sep_$gi',
            child: Divider(height: 12, thickness: 1, color: lim.border),
          ),
        );
      }
      items.add(
        DropdownMenuItem<String>(
          enabled: false,
          value: '__managed_model_hdr_${entry.family}',
          child: Text(_familyLabel(entry.family), style: headerStyle),
        ),
      );
      for (final row in entry.models) {
        items.add(
          DropdownMenuItem<String>(
            value: row.id,
            child: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Text(
                _optionLabel(row),
                overflow: TextOverflow.ellipsis,
                style: modelStyle,
              ),
            ),
          ),
        );
      }
    }
    return items;
  }

  String? _dropdownValue(
    String current,
    List<ManagedInferenceModel> allModels,
    List<ManagedInferenceModel> filtered,
    String managedProviderPref,
  ) {
    final resolved = resolveManagedModelForProviderPreference(
      current,
      allModels,
      managedProviderPref,
    );
    if (resolved.isEmpty) return null;
    if (filtered.any((m) => m.id == resolved)) return resolved;
    return resolved;
  }

  String _labelForModelId(
      List<ManagedInferenceModel> allModels, String modelId) {
    for (final row in allModels) {
      if (row.id == modelId) return _optionLabel(row);
      for (final p in row.providers) {
        if (p.id == modelId) return _optionLabel(row);
      }
    }
    return modelId;
  }

  String _optionLabel(ManagedInferenceModel row) {
    final providers = row.providers
        .map((p) => p.provider)
        .where((p) => p.isNotEmpty)
        .toList();
    final badge = providers.length > 1
        ? providers.join(' + ')
        : (providers.isNotEmpty ? providers.first : '');
    final base =
        row.label.isNotEmpty && row.label != row.id ? row.label : row.id;
    return badge.isEmpty ? base : '$base · $badge';
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final allModels = catalog?.models ?? const <ManagedInferenceModel>[];
    final models = filterManagedInferenceCatalog(allModels, managedProvider);
    final catalogSize = catalog?.models.length ?? 0;
    InputDecoration fieldDecoration() => InputDecoration(
          isDense: true,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(color: lim.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(10),
            borderSide: BorderSide(color: lim.border),
          ),
        );

    return Container(
      padding: const EdgeInsets.all(LiminalSpacing.md),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(10),
        border: BorderSide(color: lim.border).toBorder(),
        color: lim.panel,
      ),
      child: Material(
        color: Colors.transparent,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Models on your plan',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: LiminalSpacing.xs),
            Text(
              'Choose the models Liminal uses with your Vireon credits.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: lim.textMuted,
                height: 1.45,
              ),
            ),
            const SizedBox(height: LiminalSpacing.md),
            if (!singleModel &&
                managedProvider != 'openrouter' &&
                bedrockPresets.isNotEmpty &&
                onBedrockPresetApply != null)
              ExpansionTile(
                tilePadding: EdgeInsets.zero,
                title: const Text('Bedrock model presets'),
                children: [
                  Text('Bedrock preset', style: theme.textTheme.titleSmall),
                  const SizedBox(height: LiminalSpacing.xs),
                  DropdownButtonFormField<String>(
                    isExpanded: true,
                    value: bedrockPresets
                            .any((p) => p.id == selectedBedrockPresetId)
                        ? selectedBedrockPresetId
                        : 'custom',
                    decoration: fieldDecoration(),
                    dropdownColor: lim.panel,
                    style:
                        theme.textTheme.bodyMedium?.copyWith(color: lim.text),
                    items: [
                      const DropdownMenuItem(
                          value: 'custom',
                          child: Text('Custom — pick models below')),
                      for (final preset in bedrockPresets)
                        DropdownMenuItem(
                            value: preset.id, child: Text(preset.label)),
                    ],
                    onChanged: saving
                        ? null
                        : (id) {
                            if (id != null && id != 'custom')
                              onBedrockPresetApply!(id);
                          },
                  ),
                  if (selectedBedrockPresetId != 'custom')
                    Padding(
                      padding: const EdgeInsets.only(top: LiminalSpacing.xs),
                      child: Text(
                        () {
                          for (final p in bedrockPresets) {
                            if (p.id == selectedBedrockPresetId) return p.hint;
                          }
                          return '';
                        }(),
                        style: theme.textTheme.bodySmall?.copyWith(
                          color: lim.textMuted,
                          height: 1.45,
                        ),
                      ),
                    ),
                  const SizedBox(height: LiminalSpacing.md),
                ],
              ),
            Text('Model provider', style: theme.textTheme.titleSmall),
            const SizedBox(height: LiminalSpacing.xs),
            DropdownButtonFormField<String>(
              isExpanded: true,
              value:
                  _managedProviderOptions.any((e) => e.key == managedProvider)
                      ? managedProvider
                      : 'auto',
              decoration: fieldDecoration(),
              dropdownColor: lim.panel,
              style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
              items: [
                for (final opt in _managedProviderOptions)
                  DropdownMenuItem(value: opt.key, child: Text(opt.value)),
              ],
              onChanged: saving
                  ? null
                  : (v) {
                      if (v != null) onManagedProvider(v);
                    },
            ),
            const SizedBox(height: LiminalSpacing.md),
            if (managedProvider == 'openrouter' && loadOpenRouter != null) ...[
              if (error != null && error!.isNotEmpty) Text('Your managed account could not load its catalog. Check Account before using a model.', style: TextStyle(color: lim.warn)),
              OpenRouterModelPicker(
                  value: mainModel,
                  onChanged: onMainModel,
                  load: loadOpenRouter!,
                  enabled: !saving,
                  singleModel: singleModel),
              if (!singleModel)
                ExpansionTile(title: const Text('Background model'), children: [
                  OpenRouterModelPicker(
                      value: fastModel,
                      onChanged: onFastModel,
                      load: loadOpenRouter!,
                      enabled: !saving)
                ]),
            ] else if (loading)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: LiminalSpacing.sm),
                child: Center(child: CircularProgressIndicator()),
              )
            else if (error != null && error!.isNotEmpty)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    error!.toLowerCase().contains('expired')
                        ? 'Your managed-model session has expired. Sign in again from Account.'
                        : 'Models could not be loaded. Check your account connection and try again.',
                    style: TextStyle(color: theme.colorScheme.error),
                  ),
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    title: const Text('Technical details'),
                    children: [SelectableText(error!)],
                  ),
                ],
              )
            else if (models.isEmpty)
              Text(
                catalogSize == 0
                    ? 'No managed models returned. Check your license or try again.'
                    : 'No models available on $managedProvider upstream.',
                style: theme.textTheme.bodySmall?.copyWith(color: lim.warn),
              )
            else ...[
              Text('Main model', style: theme.textTheme.titleSmall),
              const SizedBox(height: LiminalSpacing.xs),
              DropdownButtonFormField<String>(
                isExpanded: true,
                value: _dropdownValue(
                    mainModel, allModels, models, managedProvider),
                decoration: fieldDecoration(),
                dropdownColor: lim.panel,
                style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
                items: _modelItems(models, allModels, mainModel,
                    managedProvider, lim, theme.textTheme),
                onChanged:
                    saving ? null : (id) => id == null ? null : onMainModel(id),
              ),
              if (!singleModel) ...[
                const SizedBox(height: LiminalSpacing.md),
                Text('Fast model', style: theme.textTheme.titleSmall),
                const SizedBox(height: LiminalSpacing.xs),
                DropdownButtonFormField<String>(
                  isExpanded: true,
                  value: _dropdownValue(
                      fastModel, allModels, models, managedProvider),
                  decoration: fieldDecoration(),
                  dropdownColor: lim.panel,
                  style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
                  items: _modelItems(models, allModels, fastModel,
                      managedProvider, lim, theme.textTheme),
                  onChanged: saving
                      ? null
                      : (id) => id == null ? null : onFastModel(id),
                ),
              ],
            ],
          ],
        ),
      ),
    );
  }
}

class _ManagedModelFamilyGroup {
  const _ManagedModelFamilyGroup({required this.family, required this.models});

  final String family;
  final List<ManagedInferenceModel> models;
}

List<_ManagedModelFamilyGroup> _groupModelsByFamily(
    List<ManagedInferenceModel> models) {
  final grouped = <String, List<ManagedInferenceModel>>{};
  for (final row in models) {
    final family = row.family.trim().isEmpty ? 'other' : row.family.trim();
    grouped.putIfAbsent(family, () => []).add(row);
  }
  final families = grouped.keys.toList()
    ..sort((a, b) {
      final dr = _familyRank(a).compareTo(_familyRank(b));
      if (dr != 0) return dr;
      return a.compareTo(b);
    });
  return [
    for (final family in families)
      _ManagedModelFamilyGroup(
        family: family,
        models: grouped[family]!..sort((a, b) => a.id.compareTo(b.id)),
      ),
  ];
}

int _familyRank(String family) {
  switch (family) {
    case 'anthropic':
      return 0;
    case 'amazon':
      return 1;
    case 'meta':
      return 2;
    case 'mistral':
      return 3;
    case 'openai':
      return 4;
    case 'deepseek':
      return 5;
    case 'qwen':
      return 6;
    case 'google':
      return 7;
    default:
      return 9;
  }
}

String _familyLabel(String family) {
  switch (family) {
    case 'anthropic':
      return 'Anthropic';
    case 'amazon':
      return 'Amazon';
    case 'meta':
      return 'Meta';
    case 'mistral':
      return 'Mistral';
    case 'openai':
      return 'OpenAI';
    case 'cohere':
      return 'Cohere';
    default:
      return family.isEmpty
          ? 'Other'
          : family[0].toUpperCase() + family.substring(1);
  }
}

extension on BorderSide {
  Border toBorder() => Border.fromBorderSide(this);
}
