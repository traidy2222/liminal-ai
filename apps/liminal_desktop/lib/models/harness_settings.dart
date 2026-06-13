import 'managed_model_family.dart';

/// Snapshot from sidecar `get_settings` (mirrors core `buildHarnessSettingsApiFields`).
class HarnessSettingsSnapshot {
  HarnessSettingsSnapshot({
    required this.tabs,
    required this.fields,
    required this.provider,
    required this.providerPresets,
    required this.providerBackends,
    this.hint,
  });

  final List<HarnessSettingsTab> tabs;
  final List<HarnessSettingsField> fields;
  final HarnessSettingsProvider provider;
  final List<ProviderPreset> providerPresets;
  final List<ProviderBackend> providerBackends;
  final String? hint;

  static List<ProviderBackend> defaultBackends() {
    return [
      ProviderBackend(
        id: 'openrouter',
        label: 'OpenRouter',
        baseURL: 'https://openrouter.ai/api/v1',
        apiKeyEnv: 'OPENROUTER_API_KEY',
        hint:
            'Hundreds of models via one API. Set OPENROUTER_API_KEY or AGENT_API_KEY.',
      ),
      ProviderBackend(
        id: 'kimchi',
        label: 'Kimchi (Cast AI)',
        baseURL: 'https://llm.cast.ai/openai/v1',
        apiKeyEnv: 'KIMCHI_API_KEY',
        hint:
            'Cast AI hosted models (kimi, minimax, nemotron). Set KIMCHI_API_KEY (castai_v1_…).',
      ),
      ProviderBackend(
        id: 'local',
        label: 'Local (LM Studio / Ollama)',
        baseURL: '',
        apiKeyEnv: 'AGENT_API_KEY',
        hint:
            'Local OpenAI-compatible servers — use any placeholder key (e.g. lm-studio).',
      ),
    ];
  }

  factory HarnessSettingsSnapshot.fromJson(Map<String, dynamic> json) {
    final backendsRaw = json['providerBackends'] as List<dynamic>? ?? [];
    return HarnessSettingsSnapshot(
      tabs: (json['tabs'] as List<dynamic>? ?? [])
          .map((e) => HarnessSettingsTab.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      fields: (json['fields'] as List<dynamic>? ?? [])
          .map((e) => HarnessSettingsField.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      provider: HarnessSettingsProvider.fromJson(
        Map<String, dynamic>.from(json['provider'] as Map? ?? {}),
      ),
      providerPresets: (json['providerPresets'] as List<dynamic>? ?? [])
          .map((e) => ProviderPreset.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
      providerBackends: backendsRaw.isEmpty
          ? defaultBackends()
          : backendsRaw
              .map((e) => ProviderBackend.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList(),
      hint: json['hint'] as String?,
    );
  }
}

class ProviderBackend {
  ProviderBackend({
    required this.id,
    required this.label,
    required this.baseURL,
    required this.apiKeyEnv,
    this.hint = '',
  });

  final String id;
  final String label;
  final String baseURL;
  final String apiKeyEnv;
  final String hint;

  factory ProviderBackend.fromJson(Map<String, dynamic> json) {
    return ProviderBackend(
      id: json['id'] as String? ?? '',
      label: json['label'] as String? ?? '',
      baseURL: json['baseURL'] as String? ?? '',
      apiKeyEnv: json['apiKeyEnv'] as String? ?? 'AGENT_API_KEY',
      hint: json['hint'] as String? ?? '',
    );
  }
}

class ProviderPreset {
  ProviderPreset({
    required this.id,
    required this.label,
    required this.hint,
    required this.baseURL,
    required this.model,
    this.harnessEnvPatch,
    this.providerBackend,
  });

  final String id;
  final String label;
  final String hint;
  final String baseURL;
  final String model;
  final Map<String, String>? harnessEnvPatch;
  final String? providerBackend;

  static String resolveSelection(
    List<ProviderPreset> presets,
    String model,
    String baseUrl,
  ) {
    final m = model.trim();
    final b = baseUrl.trim().replaceAll(RegExp(r'/+$'), '');
    for (final p in presets) {
      if (p.id == 'custom' || p.baseURL.isEmpty) continue;
      final pb = p.baseURL.trim().replaceAll(RegExp(r'/+$'), '');
      if (pb == b && p.model == m) return p.id;
    }
    return 'custom';
  }

  factory ProviderPreset.fromJson(Map<String, dynamic> json) {
    final patchRaw = json['harnessEnvPatch'];
    Map<String, String>? patch;
    if (patchRaw is Map) {
      patch = patchRaw.map((k, v) => MapEntry(k.toString(), v.toString()));
    }
    return ProviderPreset(
      id: json['id'] as String? ?? '',
      label: json['label'] as String? ?? '',
      hint: json['hint'] as String? ?? '',
      baseURL: json['baseURL'] as String? ?? '',
      model: json['model'] as String? ?? '',
      harnessEnvPatch: patch,
      providerBackend: json['providerBackend'] as String?,
    );
  }

  static String inferBackend(ProviderPreset p) {
    final tagged = p.providerBackend?.trim();
    if (tagged != null && tagged.isNotEmpty) return tagged;
    if (p.id.startsWith('kimchi-')) return 'kimchi';
    final b = p.baseURL.trim().replaceAll(RegExp(r'/+$'), '');
    if (b.contains('llm.cast.ai') || b.contains('llm.kimchi.dev')) {
      return 'kimchi';
    }
    if (b.contains('localhost') || b.contains('127.0.0.1')) return 'local';
    return 'openrouter';
  }

  static List<ProviderPreset> forBackend(
    List<ProviderPreset> presets,
    String backendId,
  ) {
    return presets
        .where((p) => p.id != 'custom' && inferBackend(p) == backendId)
        .toList();
  }
}

class HarnessSettingsTab {
  HarnessSettingsTab({required this.id, required this.title});

  final String id;
  final String title;

  factory HarnessSettingsTab.fromJson(Map<String, dynamic> json) {
    return HarnessSettingsTab(
      id: json['id'] as String? ?? '',
      title: (json['title'] ?? json['label']) as String? ?? '',
    );
  }
}

class HarnessSettingsField {
  HarnessSettingsField({
    required this.key,
    required this.label,
    required this.tabId,
    required this.subgroupId,
    required this.subgroupLabel,
    required this.valueKind,
    required this.value,
    this.description,
    this.lockedByEnv = false,
    this.enumValues,
    this.effectiveDisplay,
  });

  final String key;
  final String label;
  final String tabId;
  final String subgroupId;
  final String subgroupLabel;
  final String valueKind;
  final String value;
  final String? description;
  final bool lockedByEnv;
  final List<String>? enumValues;
  final String? effectiveDisplay;

  factory HarnessSettingsField.fromJson(Map<String, dynamic> json) {
    return HarnessSettingsField(
      key: json['key'] as String? ?? '',
      label: json['label'] as String? ?? '',
      tabId: json['tabId'] as String? ?? '',
      subgroupId: json['subgroupId'] as String? ?? '',
      subgroupLabel: json['subgroupLabel'] as String? ?? '',
      valueKind: json['valueKind'] as String? ?? 'string',
      value: json['value']?.toString() ?? '',
      description: json['description'] as String?,
      lockedByEnv: json['lockedByEnv'] as bool? ?? false,
      enumValues: (json['enumValues'] as List<dynamic>?)?.map((e) => e.toString()).toList(),
      effectiveDisplay: json['effectiveDisplay'] as String?,
    );
  }
}

class HarnessSettingsProvider {
  HarnessSettingsProvider({
    required this.model,
    required this.baseURL,
    required this.apiKeyConfigured,
    required this.modelLockedByEnv,
    required this.baseURLLockedByEnv,
    this.inferenceMode,
    this.managedRoute = false,
    this.resolvedPresetId = 'custom',
    this.resolvedBackendId = 'openrouter',
  });

  final String model;
  final String baseURL;
  final bool apiKeyConfigured;
  final bool modelLockedByEnv;
  final bool baseURLLockedByEnv;
  final String? inferenceMode;
  final bool managedRoute;
  final String resolvedPresetId;
  final String resolvedBackendId;

  bool get presetLockedByEnv => modelLockedByEnv || baseURLLockedByEnv;

  bool get showManagedInference =>
      managedRoute || (inferenceMode?.trim().toLowerCase() == 'managed');

  factory HarnessSettingsProvider.fromJson(Map<String, dynamic> json) {
    return HarnessSettingsProvider(
      model: json['model'] as String? ?? '',
      baseURL: json['baseURL'] as String? ?? '',
      apiKeyConfigured: json['apiKeyConfigured'] as bool? ?? false,
      modelLockedByEnv: json['modelLockedByEnv'] as bool? ?? false,
      baseURLLockedByEnv: json['baseURLLockedByEnv'] as bool? ?? false,
      inferenceMode: json['inferenceMode'] as String?,
      managedRoute: json['managedRoute'] as bool? ?? false,
      resolvedPresetId: json['resolvedPresetId'] as String? ?? 'custom',
      resolvedBackendId: json['resolvedBackendId'] as String? ?? 'openrouter',
    );
  }
}

class ManagedInferenceModel {
  ManagedInferenceModel({
    required this.id,
    required this.label,
    required this.family,
    this.providers = const [],
  });

  final String id;
  final String label;
  final String family;
  final List<ManagedInferenceProviderRef> providers;

  factory ManagedInferenceModel.fromJson(Map<String, dynamic> json) {
    final id = json['id'] as String? ?? '';
    final upstreamFamily = json['family'] as String?;
    final providers = (json['providers'] as List<dynamic>? ?? [])
        .map((e) => ManagedInferenceProviderRef.fromJson(Map<String, dynamic>.from(e as Map)))
        .where((p) => p.id.isNotEmpty && (p.provider == 'bedrock' || p.provider == 'openrouter'))
        .toList();
    return ManagedInferenceModel(
      id: id,
      label: json['label'] as String? ?? id,
      family: resolveManagedModelFamily(id, upstreamFamily),
      providers: inferManagedModelProviders(
        id,
        providers.isEmpty ? null : providers,
      ),
    );
  }
}

class ManagedInferenceModelsCatalog {
  ManagedInferenceModelsCatalog({
    required this.upstream,
    required this.region,
    required this.models,
  });

  final String upstream;
  final String region;
  final List<ManagedInferenceModel> models;

  factory ManagedInferenceModelsCatalog.fromJson(Map<String, dynamic> json) {
    return ManagedInferenceModelsCatalog(
      upstream: json['upstream'] as String? ?? 'bedrock',
      region: json['region'] as String? ?? '',
      models: (json['models'] as List<dynamic>? ?? [])
          .map((e) => ManagedInferenceModel.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList(),
    );
  }
}

ManagedInferenceModel _withInferredProviders(ManagedInferenceModel row) {
  return ManagedInferenceModel(
    id: row.id,
    label: row.label,
    family: row.family,
    providers: inferManagedModelProviders(row.id, row.providers),
  );
}

List<ManagedInferenceModel> filterManagedCatalogForProvider(
  List<ManagedInferenceModel> models,
  String preference,
) {
  final pref = preference.trim().isEmpty ? 'auto' : preference.trim().toLowerCase();
  final normalized = models.map(_withInferredProviders).toList();
  if (pref == 'auto') return normalized;
  return normalized.where((m) => managedModelAvailableOnProvider(m.providers, pref)).toList();
}

ManagedInferenceModel? findManagedCatalogRowByModelId(
  List<ManagedInferenceModel> models,
  String modelId,
) {
  final needle = modelId.trim();
  if (needle.isEmpty) return null;
  for (final row in models) {
    final providers = inferManagedModelProviders(row.id, row.providers);
    if (row.id == needle || providers.any((p) => p.id == needle)) {
      return ManagedInferenceModel(
        id: row.id,
        label: row.label,
        family: row.family,
        providers: providers,
      );
    }
  }
  return null;
}

String displayLabelForManagedCatalogRow(ManagedInferenceModel row, String preference) {
  final pref = preference.trim().isEmpty ? 'auto' : preference.trim().toLowerCase();
  final providers = inferManagedModelProviders(row.id, row.providers);
  final slug = resolveModelIdForManagedProvider(row.id, pref, providers);
  if (pref == 'bedrock' || pref == 'openrouter') return slug;
  return row.label.trim().isNotEmpty ? row.label.trim() : row.id;
}

String emptyManagedProviderFilterMessage(
  List<ManagedInferenceModel> models,
  String preference, [
  String? upstream,
]) {
  final pref = preference.trim().isEmpty ? 'auto' : preference.trim().toLowerCase();
  if (pref == 'auto' || models.isEmpty) {
    return pref == 'openrouter'
        ? 'No OpenRouter models in the managed catalog.'
        : pref == 'bedrock'
            ? 'No Bedrock models in the managed catalog.'
            : 'No managed models returned.';
  }
  final hasMeta = models.any((m) => m.providers.isNotEmpty);
  final upstreamHint = upstream?.trim().toLowerCase();
  if (pref == 'openrouter' && !managedCatalogHasProvider(models, 'openrouter')) {
    if (!hasMeta || upstreamHint == 'bedrock') {
      return 'OpenRouter catalog not available from Vireon yet — the server is still '
          'returning Bedrock-only models. Use Auto/Bedrock, or deploy hybrid inference '
          'with VIREON_OPENROUTER_API_KEY on the control plane.';
    }
    return 'No OpenRouter models in the merged catalog for this account.';
  }
  if (pref == 'bedrock' && !managedCatalogHasProvider(models, 'bedrock')) {
    return 'No Bedrock models in the managed catalog for this account.';
  }
  return 'No models on $pref for this account.';
}

bool managedCatalogHasProvider(List<ManagedInferenceModel> models, String provider) {
  final pref = provider.trim().toLowerCase();
  if (pref != 'bedrock' && pref != 'openrouter') return models.isNotEmpty;
  return models.any((m) => managedModelAvailableOnProvider(
        inferManagedModelProviders(m.id, m.providers),
        pref,
      ));
}

String remapManagedModelIdForProvider(
  String currentModelId,
  String nextPreference,
  List<ManagedInferenceModel> models,
) {
  final current = currentModelId.trim();
  final pref = nextPreference.trim().toLowerCase();
  if (current.isEmpty || pref == 'auto') return currentModelId;
  final row = findManagedCatalogRowByModelId(models, current);
  if (row == null) return currentModelId;
  return resolveModelIdForManagedProvider(row.id, pref, row.providers);
}
