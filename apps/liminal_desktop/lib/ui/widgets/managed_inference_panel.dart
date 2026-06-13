import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../../models/managed_model_family.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

class ManagedInferencePanel extends StatelessWidget {
  const ManagedInferencePanel({
    super.key,
    required this.mainModel,
    required this.fastModel,
    required this.managedProvider,
    required this.catalog,
    required this.loading,
    required this.error,
    required this.saving,
    required this.onMainModel,
    required this.onFastModel,
    required this.onManagedProvider,
    this.upstream,
  });

  final String mainModel;
  final String fastModel;
  final String managedProvider;
  final ManagedInferenceModelsCatalog? catalog;
  final bool loading;
  final String? error;
  final bool saving;
  final String? upstream;
  final ValueChanged<String> onMainModel;
  final ValueChanged<String> onFastModel;
  final ValueChanged<String> onManagedProvider;

  List<DropdownMenuItem<String>> _modelItems(
    List<ManagedInferenceModel> models,
    String preference,
    LiminalTokens lim,
    TextTheme textTheme,
  ) {
    final items = <DropdownMenuItem<String>>[];
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
    final badgeStyle = textTheme.labelSmall?.copyWith(
      color: lim.textMuted,
      fontSize: 10,
      letterSpacing: 0.2,
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
        final badge = formatManagedModelProviderBadge(row.providers);
        items.add(
          DropdownMenuItem<String>(
            value: row.id,
            child: Padding(
              padding: const EdgeInsets.only(left: 8),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      displayLabelForManagedCatalogRow(row, preference),
                      overflow: TextOverflow.ellipsis,
                      style: modelStyle,
                    ),
                  ),
                  if (badge != null) ...[
                    const SizedBox(width: 8),
                    Text(badge, style: badgeStyle),
                  ],
                ],
              ),
            ),
          ),
        );
      }
    }
    return items;
  }

  String? _dropdownValue(String current, List<ManagedInferenceModel> models) {
    return findManagedCatalogRowByModelId(models, current)?.id;
  }

  String _providerLabel(String value) {
    switch (value) {
      case 'bedrock':
        return 'Bedrock';
      case 'openrouter':
        return 'OpenRouter';
      case 'kimchi':
        return 'Kimchi';
      default:
        return 'Auto';
    }
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final pref = managedProvider.isEmpty ? 'auto' : managedProvider;
    final allModels = catalog?.models ?? const <ManagedInferenceModel>[];
    final models = filterManagedCatalogForProvider(allModels, pref);
    final upstreamLabel = upstream ?? catalog?.upstream ?? 'hybrid';

    InputDecoration fieldDecoration() => InputDecoration(
          isDense: true,
          border: OutlineInputBorder(
            borderRadius: BorderRadius.circular(4),
            borderSide: BorderSide(color: lim.border),
          ),
          enabledBorder: OutlineInputBorder(
            borderRadius: BorderRadius.circular(4),
            borderSide: BorderSide(color: lim.border),
          ),
        );

    return Container(
      padding: const EdgeInsets.all(LiminalSpacing.md),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(4),
        border: BorderSide(color: lim.border).toBorder(),
        color: lim.panel.withValues(alpha: 0.65),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Managed inference (Vireon · $upstreamLabel)',
            style: theme.textTheme.titleSmall?.copyWith(color: lim.success),
          ),
          const SizedBox(height: LiminalSpacing.xs),
          Text(
            'Hybrid routing — Bedrock, OpenRouter, and Kimchi (Cast AI) with per-provider fallback when equivalents exist.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: lim.textMuted,
              height: 1.45,
            ),
          ),
          const SizedBox(height: LiminalSpacing.md),
          Text('Managed provider', style: theme.textTheme.titleSmall),
          const SizedBox(height: LiminalSpacing.xs),
          SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'auto', label: Text('Auto')),
              ButtonSegment(value: 'bedrock', label: Text('Bedrock')),
              ButtonSegment(value: 'openrouter', label: Text('OpenRouter')),
              ButtonSegment(value: 'kimchi', label: Text('Kimchi')),
            ],
            selected: {managedProvider.isEmpty ? 'auto' : managedProvider},
            onSelectionChanged: saving
                ? null
                : (selected) {
                    final next = selected.first;
                    if (next != managedProvider) onManagedProvider(next);
                  },
            style: ButtonStyle(
              visualDensity: VisualDensity.compact,
              textStyle: WidgetStatePropertyAll(theme.textTheme.labelSmall),
            ),
          ),
          Padding(
            padding: const EdgeInsets.only(top: LiminalSpacing.xs),
            child: Text(
              '${_providerLabel(managedProvider.isEmpty ? 'auto' : managedProvider)}: route by model shape, or pin a provider and fail over to the equivalent.',
              style: theme.textTheme.bodySmall?.copyWith(color: lim.textMuted, height: 1.4),
            ),
          ),
          const SizedBox(height: LiminalSpacing.md),
          if (loading)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: LiminalSpacing.sm),
              child: Center(child: CircularProgressIndicator()),
            )
          else if (error != null && error!.isNotEmpty)
            Text(error!, style: TextStyle(color: theme.colorScheme.error))
          else if (models.isEmpty)
            Text(
              allModels.isEmpty
                  ? 'No managed models returned. Check your license or try again.'
                  : emptyManagedProviderFilterMessage(allModels, pref, upstreamLabel),
              style: theme.textTheme.bodySmall?.copyWith(color: lim.warn),
            )
          else ...[
            Text('Main model', style: theme.textTheme.titleSmall),
            const SizedBox(height: LiminalSpacing.xs),
            DropdownButtonFormField<String>(
              key: ValueKey('managed-main-$pref'),
              value: _dropdownValue(mainModel, models),
              decoration: fieldDecoration(),
              dropdownColor: lim.panel,
              style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
              items: _modelItems(models, pref, lim, theme.textTheme),
              onChanged: saving ? null : (id) => id == null ? null : onMainModel(id),
            ),
            const SizedBox(height: LiminalSpacing.md),
            Text('Fast model', style: theme.textTheme.titleSmall),
            const SizedBox(height: LiminalSpacing.xs),
            DropdownButtonFormField<String>(
              key: ValueKey('managed-fast-$pref'),
              value: _dropdownValue(fastModel, models),
              decoration: fieldDecoration(),
              dropdownColor: lim.panel,
              style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
              items: _modelItems(models, pref, lim, theme.textTheme),
              onChanged: saving ? null : (id) => id == null ? null : onFastModel(id),
            ),
          ],
        ],
      ),
    );
  }
}

class _ManagedModelFamilyGroup {
  const _ManagedModelFamilyGroup({required this.family, required this.models});

  final String family;
  final List<ManagedInferenceModel> models;
}

List<_ManagedModelFamilyGroup> _groupModelsByFamily(List<ManagedInferenceModel> models) {
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
      _ManagedModelFamilyGroup(family: family, models: grouped[family]!),
  ];
}

int _familyRank(String family) => managedModelFamilyRank(family);

String _familyLabel(String family) => managedModelFamilyLabel(family);

extension on BorderSide {
  Border toBorder() => Border.fromBorderSide(this);
}
