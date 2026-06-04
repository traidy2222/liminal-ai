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

  factory AppConfig.fromJson(Map<String, dynamic> json) {
    final provider = (json['provider'] as Map<String, dynamic>?) ?? {};
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
    );
  }
}
