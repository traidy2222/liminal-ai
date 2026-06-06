import 'persona_ui_copy.dart';
import 'persona_ui_theme.dart';

class AppConfig {
  AppConfig({
    required this.apiKeyConfigured,
    required this.personaBootstrapEnabled,
    required this.personaBootstrapPending,
    required this.personaBootstrapAllowSkip,
    required this.personaDisplayLabel,
    required this.providerModel,
    required this.providerBaseUrl,
    required this.modelLockedByEnv,
    required this.baseUrlLockedByEnv,
    required this.repoRoot,
    this.personaUiTheme,
    this.personaUiCopy,
    this.ttsEnabled = false,
    this.ttsVoice = 'af_sky',
    this.dictationAudioCue = false,
    this.dictationMinRecordingMs = 1500,
    this.dictationSilenceMsShort = 1500,
    this.dictationSilenceMsLong = 2500,
    this.dictationMaxRecordingMs = 60000,
  });

  final bool apiKeyConfigured;
  final bool personaBootstrapEnabled;
  final bool personaBootstrapPending;
  final bool personaBootstrapAllowSkip;
  final String personaDisplayLabel;
  final String providerModel;
  final String providerBaseUrl;
  final bool modelLockedByEnv;
  final bool baseUrlLockedByEnv;
  final String repoRoot;
  final PersonaUiTheme? personaUiTheme;
  final PersonaUiCopy? personaUiCopy;
  final bool ttsEnabled;
  final String ttsVoice;
  final bool dictationAudioCue;
  final int dictationMinRecordingMs;
  final int dictationSilenceMsShort;
  final int dictationSilenceMsLong;
  final int dictationMaxRecordingMs;

  PersonaUiTheme get resolvedTheme {
    if (personaUiTheme != null) return personaUiTheme!;
    return PersonaUiTheme(
      accent: PersonaUiTheme.liminalDefault.accent,
      secondary: PersonaUiTheme.liminalDefault.secondary,
      warn: PersonaUiTheme.liminalDefault.warn,
      danger: PersonaUiTheme.liminalDefault.danger,
      success: PersonaUiTheme.liminalDefault.success,
      muted: PersonaUiTheme.liminalDefault.muted,
      surfaceTint: PersonaUiTheme.liminalDefault.surfaceTint,
      displayLabel: personaDisplayLabel,
    );
  }

  /// Persona microcopy, or neutral defaults when none was generated.
  PersonaUiCopy get resolvedCopy => personaUiCopy ?? PersonaUiCopy.fallback;

  AppConfig copyWith({
    bool? apiKeyConfigured,
    bool? personaBootstrapEnabled,
    bool? personaBootstrapPending,
    bool? personaBootstrapAllowSkip,
    String? personaDisplayLabel,
    String? providerModel,
    String? providerBaseUrl,
    bool? modelLockedByEnv,
    bool? baseUrlLockedByEnv,
    String? repoRoot,
    PersonaUiTheme? personaUiTheme,
    PersonaUiCopy? personaUiCopy,
    bool? ttsEnabled,
    String? ttsVoice,
    bool? dictationAudioCue,
    int? dictationMinRecordingMs,
    int? dictationSilenceMsShort,
    int? dictationSilenceMsLong,
    int? dictationMaxRecordingMs,
  }) {
    return AppConfig(
      apiKeyConfigured: apiKeyConfigured ?? this.apiKeyConfigured,
      personaBootstrapEnabled: personaBootstrapEnabled ?? this.personaBootstrapEnabled,
      personaBootstrapPending: personaBootstrapPending ?? this.personaBootstrapPending,
      personaBootstrapAllowSkip: personaBootstrapAllowSkip ?? this.personaBootstrapAllowSkip,
      personaDisplayLabel: personaDisplayLabel ?? this.personaDisplayLabel,
      providerModel: providerModel ?? this.providerModel,
      providerBaseUrl: providerBaseUrl ?? this.providerBaseUrl,
      modelLockedByEnv: modelLockedByEnv ?? this.modelLockedByEnv,
      baseUrlLockedByEnv: baseUrlLockedByEnv ?? this.baseUrlLockedByEnv,
      repoRoot: repoRoot ?? this.repoRoot,
      personaUiTheme: personaUiTheme ?? this.personaUiTheme,
      personaUiCopy: personaUiCopy ?? this.personaUiCopy,
      ttsEnabled: ttsEnabled ?? this.ttsEnabled,
      ttsVoice: ttsVoice ?? this.ttsVoice,
      dictationAudioCue: dictationAudioCue ?? this.dictationAudioCue,
      dictationMinRecordingMs: dictationMinRecordingMs ?? this.dictationMinRecordingMs,
      dictationSilenceMsShort: dictationSilenceMsShort ?? this.dictationSilenceMsShort,
      dictationSilenceMsLong: dictationSilenceMsLong ?? this.dictationSilenceMsLong,
      dictationMaxRecordingMs: dictationMaxRecordingMs ?? this.dictationMaxRecordingMs,
    );
  }

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    final provider = (json['provider'] as Map<String, dynamic>?) ?? {};
    int ms(String key, int fallback) {
      final v = json[key];
      if (v is int) return v;
      if (v is num) return v.round();
      return fallback;
    }
    return AppConfig(
      apiKeyConfigured: json['apiKeyConfigured'] as bool? ?? false,
      personaBootstrapEnabled: json['personaBootstrapEnabled'] as bool? ?? true,
      personaBootstrapPending: json['personaBootstrapPending'] as bool? ?? false,
      personaBootstrapAllowSkip: json['personaBootstrapAllowSkip'] as bool? ?? true,
      personaDisplayLabel: json['personaDisplayLabel'] as String? ?? 'Liminal',
      providerModel: provider['model'] as String? ?? '',
      providerBaseUrl: provider['baseURL'] as String? ?? '',
      modelLockedByEnv: provider['modelLockedByEnv'] as bool? ?? false,
      baseUrlLockedByEnv: provider['baseURLLockedByEnv'] as bool? ?? false,
      repoRoot: json['repoRoot'] as String? ?? '',
      personaUiTheme: json['personaUiTheme'] is Map
          ? PersonaUiTheme.fromJson(
              Map<String, dynamic>.from(json['personaUiTheme'] as Map),
            )
          : null,
      personaUiCopy: json['personaUiCopy'] is Map
          ? PersonaUiCopy.fromJson(
              Map<String, dynamic>.from(json['personaUiCopy'] as Map),
            )
          : null,
      ttsEnabled: json['ttsEnabled'] as bool? ?? false,
      ttsVoice: json['ttsVoice'] as String? ?? 'af_sky',
      dictationAudioCue: json['dictationAudioCue'] as bool? ?? false,
      dictationMinRecordingMs: ms('dictationMinRecordingMs', 1500),
      dictationSilenceMsShort: ms('dictationSilenceMsShort', 1500),
      dictationSilenceMsLong: ms('dictationSilenceMsLong', 2500),
      dictationMaxRecordingMs: ms('dictationMaxRecordingMs', 60000),
    );
  }
}
