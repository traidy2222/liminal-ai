/// Bedrock managed-inference model family grouping (mirrors core managed_model_family.ts).

final _regionalPrefix = RegExp(r'^(us|eu|global|au|jp|ap)-?\.', caseSensitive: false);

const _providerToFamily = <String, String>{
  'anthropic': 'anthropic',
  'amazon': 'amazon',
  'meta': 'meta',
  'mistral': 'mistral',
  'ministral': 'mistral',
  'cohere': 'cohere',
  'openai': 'openai',
  'deepseek': 'deepseek',
  'qwen': 'qwen',
  'moonshotai': 'moonshotai',
  'google': 'google',
  'nvidia': 'nvidia',
  'ai21': 'ai21',
  'stability': 'stability',
  'writer': 'writer',
  'twelvelabs': 'twelvelabs',
  'luma': 'luma',
};

const _familyLabels = <String, String>{
  'anthropic': 'Anthropic',
  'amazon': 'Amazon',
  'meta': 'Meta',
  'mistral': 'Mistral',
  'openai': 'OpenAI',
  'cohere': 'Cohere',
  'deepseek': 'DeepSeek',
  'qwen': 'Qwen',
  'moonshotai': 'Moonshot AI',
  'google': 'Google',
  'nvidia': 'NVIDIA',
  'ai21': 'AI21',
  'stability': 'Stability AI',
  'writer': 'Writer',
  'twelvelabs': 'Twelve Labs',
  'luma': 'Luma',
  'other': 'Other',
};

const _familyRank = <String, int>{
  'anthropic': 0,
  'openai': 1,
  'amazon': 2,
  'meta': 3,
  'google': 4,
  'deepseek': 5,
  'qwen': 6,
  'mistral': 7,
  'moonshotai': 8,
  'nvidia': 9,
  'cohere': 10,
  'ai21': 11,
  'stability': 12,
  'writer': 13,
  'twelvelabs': 14,
  'luma': 15,
  'other': 99,
};

String? _bedrockProviderPrefix(String id) {
  var lower = id.trim().toLowerCase();
  if (lower.isEmpty) return null;
  lower = lower.replaceFirst(_regionalPrefix, '');
  final dot = lower.indexOf('.');
  if (dot <= 0) return null;
  return lower.substring(0, dot);
}

String? _inferFamilyFromKeywords(String id) {
  final lower = id.toLowerCase();
  if (lower.contains('anthropic') || lower.contains('claude')) return 'anthropic';
  if (lower.contains('nova') || lower.contains('titan')) return 'amazon';
  if (lower.contains('llama')) return 'meta';
  if (lower.contains('ministral') || lower.contains('mistral')) return 'mistral';
  if (lower.contains('cohere') || lower.contains('command-r')) return 'cohere';
  if (lower.contains('gpt-oss') || lower.contains('openai')) return 'openai';
  if (lower.contains('deepseek')) return 'deepseek';
  if (lower.contains('qwen')) return 'qwen';
  if (lower.contains('moonshot') || lower.contains('kimi')) return 'moonshotai';
  if (lower.contains('gemini') || lower.contains('gemma')) return 'google';
  if (lower.contains('nemotron') || lower.contains('nvidia')) return 'nvidia';
  if (lower.contains('jamba') || lower.contains('ai21')) return 'ai21';
  if (lower.contains('stable-diffusion') || lower.contains('stability')) {
    return 'stability';
  }
  if (lower.contains('palmyra') || lower.contains('writer')) return 'writer';
  if (lower.contains('twelve') || lower.contains('pegasus')) return 'twelvelabs';
  if (lower.contains('luma')) return 'luma';
  return null;
}

String inferManagedModelFamily(String id) {
  final prefix = _bedrockProviderPrefix(id);
  if (prefix != null) {
    final mapped = _providerToFamily[prefix];
    if (mapped != null) return mapped;
  }
  return _inferFamilyFromKeywords(id) ?? 'other';
}

String resolveManagedModelFamily(String id, String? upstreamFamily) {
  final fromId = inferManagedModelFamily(id);
  if (fromId != 'other') return fromId;
  final upstream = upstreamFamily?.trim().toLowerCase();
  if (upstream != null && upstream.isNotEmpty && upstream != 'other') {
    return upstream;
  }
  return 'other';
}

String managedModelFamilyLabel(String family) {
  final key = family.trim().toLowerCase();
  final known = _familyLabels[key];
  if (known != null) return known;
  if (key.isEmpty || key == 'other') return 'Other';
  return key
      .split(RegExp(r'[_-]'))
      .where((part) => part.isNotEmpty)
      .map((part) => part[0].toUpperCase() + part.substring(1))
      .join(' ');
}

int managedModelFamilyRank(String family) {
  return _familyRank[family.trim().toLowerCase()] ?? 50;
}

bool looksLikeBedrockModelId(String model) {
  final m = model.trim();
  if (m.isEmpty) return false;
  if (_regionalPrefix.hasMatch(m)) return true;
  return m.contains('.') && !m.contains('/');
}

List<ManagedInferenceProviderRef> inferManagedModelProviders(
  String id, [
  List<ManagedInferenceProviderRef>? existing,
]) {
  if (existing != null && existing.isNotEmpty) return existing;
  final trimmed = id.trim();
  if (trimmed.isEmpty) return const [];
  if (looksLikeBedrockModelId(trimmed)) {
    return [ManagedInferenceProviderRef(provider: 'bedrock', id: trimmed)];
  }
  return [ManagedInferenceProviderRef(provider: 'openrouter', id: trimmed)];
}

bool managedModelAvailableOnProvider(
  List<ManagedInferenceProviderRef> providers,
  String preference,
) {
  final pref = preference.trim().toLowerCase();
  if (pref != 'bedrock' && pref != 'openrouter') return true;
  return providers.any((p) => p.provider == pref);
}

String resolveModelIdForManagedProvider(
  String displayId,
  String preference,
  List<ManagedInferenceProviderRef> providers,
) {
  final pref = preference.trim().toLowerCase();
  if (pref != 'bedrock' && pref != 'openrouter') return displayId;
  if (providers.isEmpty) return displayId;
  for (final p in providers) {
    if (p.provider == pref && p.id.trim().isNotEmpty) return p.id.trim();
  }
  return displayId;
}

String? formatManagedModelProviderBadge(List<ManagedInferenceProviderRef> providers) {
  if (providers.isEmpty) return null;
  final hasBedrock = providers.any((p) => p.provider == 'bedrock');
  final hasOr = providers.any((p) => p.provider == 'openrouter');
  if (hasBedrock && hasOr) return 'BR+OR';
  if (hasBedrock) return 'BR';
  if (hasOr) return 'OR';
  return null;
}

class ManagedInferenceProviderRef {
  const ManagedInferenceProviderRef({required this.provider, required this.id});

  final String provider;
  final String id;

  factory ManagedInferenceProviderRef.fromJson(Map<String, dynamic> json) {
    return ManagedInferenceProviderRef(
      provider: json['provider'] as String? ?? '',
      id: json['id'] as String? ?? '',
    );
  }
}
