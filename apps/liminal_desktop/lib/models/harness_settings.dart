/// Snapshot from sidecar `get_settings` (mirrors core `buildHarnessSettingsApiFields`).
class HarnessSettingsSnapshot {
  HarnessSettingsSnapshot({
    required this.tabs,
    required this.fields,
    required this.provider,
    this.hint,
  });

  final List<HarnessSettingsTab> tabs;
  final List<HarnessSettingsField> fields;
  final HarnessSettingsProvider provider;
  final String? hint;

  factory HarnessSettingsSnapshot.fromJson(Map<String, dynamic> json) {
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
      hint: json['hint'] as String?,
    );
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
  });

  final String model;
  final String baseURL;
  final bool apiKeyConfigured;
  final bool modelLockedByEnv;
  final bool baseURLLockedByEnv;
  final String? inferenceMode;

  factory HarnessSettingsProvider.fromJson(Map<String, dynamic> json) {
    return HarnessSettingsProvider(
      model: json['model'] as String? ?? '',
      baseURL: json['baseURL'] as String? ?? '',
      apiKeyConfigured: json['apiKeyConfigured'] as bool? ?? false,
      modelLockedByEnv: json['modelLockedByEnv'] as bool? ?? false,
      baseURLLockedByEnv: json['baseURLLockedByEnv'] as bool? ?? false,
      inferenceMode: json['inferenceMode'] as String?,
    );
  }
}
