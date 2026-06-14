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
