import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';
import '../theme/liminal_tokens.dart';

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
    this.upstream,
  });

  final String mainModel;
  final String fastModel;
  final ManagedInferenceModelsCatalog? catalog;
  final bool loading;
  final String? error;
  final bool saving;
  final String? upstream;
  final ValueChanged<String> onMainModel;
  final ValueChanged<String> onFastModel;

  List<DropdownMenuItem<String>> _modelItems(
    List<ManagedInferenceModel> models,
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
              child: Text(row.id, overflow: TextOverflow.ellipsis, style: modelStyle),
            ),
          ),
        );
      }
    }
    return items;
  }

  String? _dropdownValue(String current, List<ManagedInferenceModel> models) {
    if (models.any((m) => m.id == current)) return current;
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final lim = LiminalTheme.of(context);
    final theme = Theme.of(context);
    final models = catalog?.models ?? const <ManagedInferenceModel>[];
    final upstreamLabel = upstream ?? catalog?.upstream ?? 'bedrock';

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
            'Pro routing through Vireon — no OpenRouter or Kimchi API key required.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: lim.textMuted,
              height: 1.45,
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
              'No Bedrock models returned. Check your license or try again.',
              style: theme.textTheme.bodySmall?.copyWith(color: lim.warn),
            )
          else ...[
            Text('Main model', style: theme.textTheme.titleSmall),
            const SizedBox(height: LiminalSpacing.xs),
            DropdownButtonFormField<String>(
              value: _dropdownValue(mainModel, models),
              decoration: fieldDecoration(),
              dropdownColor: lim.panel,
              style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
              items: _modelItems(models, lim, theme.textTheme),
              onChanged: saving ? null : (id) => id == null ? null : onMainModel(id),
            ),
            const SizedBox(height: LiminalSpacing.md),
            Text('Fast model', style: theme.textTheme.titleSmall),
            const SizedBox(height: LiminalSpacing.xs),
            DropdownButtonFormField<String>(
              value: _dropdownValue(fastModel, models),
              decoration: fieldDecoration(),
              dropdownColor: lim.panel,
              style: theme.textTheme.bodyMedium?.copyWith(color: lim.text),
              items: _modelItems(models, lim, theme.textTheme),
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
    case 'cohere':
      return 5;
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
      return 'Other';
  }
}

extension on BorderSide {
  Border toBorder() => Border.fromBorderSide(this);
}
