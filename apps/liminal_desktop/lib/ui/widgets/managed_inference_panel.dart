import 'package:flutter/material.dart';

import '../../models/harness_settings.dart';
import '../layout/liminal_spacing.dart';
import '../theme/liminal_theme_extension.dart';

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

  List<DropdownMenuItem<String>> _modelItems(List<ManagedInferenceModel> models) {
    final sorted = [...models]..sort((a, b) => a.label.compareTo(b.label));
    return [
      for (final row in sorted)
        DropdownMenuItem(
          value: row.id,
          child: Text(row.label, overflow: TextOverflow.ellipsis),
        ),
    ];
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
              items: _modelItems(models),
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
              items: _modelItems(models),
              onChanged: saving ? null : (id) => id == null ? null : onFastModel(id),
            ),
          ],
        ],
      ),
    );
  }
}

extension on BorderSide {
  Border toBorder() => Border.fromBorderSide(this);
}
