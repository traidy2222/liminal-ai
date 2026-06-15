import 'harness_settings.dart';

final _bedrockGeoPrefix = RegExp(r'^(us|eu|global|apac|au|jp)\.', caseSensitive: false);

bool looksLikeKimchiModelId(String model) {
  final m = model.trim().toLowerCase();
  if (m.isEmpty || m.contains('/')) return false;
  if (RegExp(r'^(kimi-|minimax-|nemotron-)').hasMatch(m)) return true;
  return !m.contains('.');
}

bool looksLikeBedrockModelId(String model) {
  final m = model.trim();
  if (m.isEmpty || looksLikeKimchiModelId(m)) return false;
  if (_bedrockGeoPrefix.hasMatch(m)) return true;
  return m.contains('.') && !m.contains('/');
}

String modelNativeManagedProvider(String model) {
  if (looksLikeBedrockModelId(model)) return 'bedrock';
  if (looksLikeKimchiModelId(model)) return 'kimchi';
  return 'openrouter';
}

ManagedInferenceModel? narrowManagedModelForProvider(
  ManagedInferenceModel model,
  String preference,
) {
  final pref = preference.trim().toLowerCase();
  if (pref.isEmpty || pref == 'auto') return model;

  final providers = model.providers.where((p) => p.id.trim().isNotEmpty).toList();
  for (final ref in providers) {
    if (ref.provider == pref) {
      return ManagedInferenceModel(
        id: ref.id,
        label: model.label,
        family: model.family,
        providers: [ref],
      );
    }
  }
  if (providers.isNotEmpty) return null;
  if (modelNativeManagedProvider(model.id) != pref) return null;
  return ManagedInferenceModel(
    id: model.id,
    label: model.label,
    family: model.family,
    providers: [ManagedInferenceProviderRef(provider: pref, id: model.id)],
  );
}

List<ManagedInferenceModel> filterManagedInferenceCatalog(
  List<ManagedInferenceModel> models,
  String preference,
) {
  final pref = preference.trim().toLowerCase();
  if (pref.isEmpty || pref == 'auto') return models;
  final out = <ManagedInferenceModel>[];
  for (final model in models) {
    final narrowed = narrowManagedModelForProvider(model, pref);
    if (narrowed != null) out.add(narrowed);
  }
  return out;
}

bool _catalogRowOwnsModelId(ManagedInferenceModel row, String modelId) {
  final target = modelId.trim();
  if (target.isEmpty) return false;
  if (row.id.trim() == target) return true;
  return row.providers.any((p) => p.id.trim() == target);
}

final _bedrockGeoStrip = RegExp(r'^(us|eu|global|apac|au|jp)\.', caseSensitive: false);

String? _bedrockIdWithoutGeoPrefix(String modelId) {
  final m = modelId.trim();
  if (m.isEmpty || m.contains('/')) return null;
  if (!_bedrockGeoStrip.hasMatch(m)) return null;
  return m.replaceFirst(_bedrockGeoStrip, '');
}

bool _catalogRowMatchesBedrockStem(ManagedInferenceModel row, String stem) {
  final ids = <String>[row.id, ...row.providers.map((p) => p.id)];
  for (final bare in ids) {
    final trimmed = bare.trim();
    if (trimmed.isEmpty) continue;
    if (trimmed == stem) return true;
    final stripped = _bedrockIdWithoutGeoPrefix(trimmed);
    if (stripped == stem) return true;
  }
  return false;
}

/// Map a saved model id to the catalog row id for the active upstream filter.
String resolveManagedModelForProviderPreference(
  String model,
  List<ManagedInferenceModel> catalog,
  String preference,
) {
  final trimmed = model.trim();
  if (trimmed.isEmpty) return trimmed;
  final pref = preference.trim().toLowerCase();
  final filtered = filterManagedInferenceCatalog(catalog, pref);
  if (filtered.any((m) => m.id == trimmed)) return trimmed;
  for (final row in catalog) {
    if (!_catalogRowOwnsModelId(row, trimmed)) continue;
    if (pref.isEmpty || pref == 'auto') return row.id;
    final narrowed = narrowManagedModelForProvider(row, pref);
    if (narrowed != null) return narrowed.id;
  }
  final stem = _bedrockIdWithoutGeoPrefix(trimmed) ?? trimmed;
  if (pref.isNotEmpty && pref != 'auto') {
    for (final row in catalog) {
      if (!_catalogRowMatchesBedrockStem(row, stem)) continue;
      final narrowed = narrowManagedModelForProvider(row, pref);
      if (narrowed != null) return narrowed.id;
    }
  }
  return trimmed;
}
