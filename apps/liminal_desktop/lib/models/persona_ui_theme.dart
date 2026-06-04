import 'package:flutter/material.dart';

/// Persona UI theme V2 — mirrors `@liminal/core` `DEFAULT_PERSONA_UI_THEME`.
class PersonaUiTheme {
  const PersonaUiTheme({
    required this.accent,
    required this.secondary,
    required this.warn,
    required this.danger,
    required this.success,
    required this.muted,
    required this.surfaceTint,
    required this.displayLabel,
    this.shell = 'hud',
    this.density = 'comfortable',
    this.radius = 'soft',
    this.typography = 'mixed',
    this.fontPair = 'inter-cascadia',
    this.messageStyle = 'bubble',
    this.background = 'grid',
  });

  final Color accent;
  final Color secondary;
  final Color warn;
  final Color danger;
  final Color success;
  final Color muted;
  final Color surfaceTint;
  final String displayLabel;
  final String shell;
  final String density;
  final String radius;
  final String typography;
  /// `system` | `ibm-plex` | `jetbrains` | `inter-cascadia` | `playfair` | `geist`
  final String fontPair;
  final String messageStyle;
  final String background;

  static const liminalDefault = PersonaUiTheme(
    accent: Color(0xFF00D4FF),
    secondary: Color(0xFFFF4488),
    warn: Color(0xFFFFB347),
    danger: Color(0xFFFF2244),
    success: Color(0xFF00FF88),
    muted: Color(0xFF778899),
    surfaceTint: Color(0xFF0A1018),
    displayLabel: 'Liminal',
  );

  factory PersonaUiTheme.fromJson(Map<String, dynamic>? json) {
    if (json == null || json.isEmpty) return liminalDefault;
    return PersonaUiTheme(
      accent: _hex(json['accent'], liminalDefault.accent),
      secondary: _hex(json['secondary'], liminalDefault.secondary),
      warn: _hex(json['warn'], liminalDefault.warn),
      danger: _hex(json['danger'], liminalDefault.danger),
      success: _hex(json['success'], liminalDefault.success),
      muted: _hex(json['muted'], liminalDefault.muted),
      surfaceTint: _hex(json['surfaceTint'], liminalDefault.surfaceTint),
      displayLabel: (json['displayLabel'] as String?)?.trim().isNotEmpty == true
          ? json['displayLabel'] as String
          : liminalDefault.displayLabel,
      shell: json['shell'] as String? ?? liminalDefault.shell,
      density: json['density'] as String? ?? liminalDefault.density,
      radius: json['radius'] as String? ?? liminalDefault.radius,
      typography: json['typography'] as String? ?? liminalDefault.typography,
      fontPair: json['fontPair'] as String? ?? liminalDefault.fontPair,
      messageStyle: json['messageStyle'] as String? ?? liminalDefault.messageStyle,
      background: json['background'] as String? ?? liminalDefault.background,
    );
  }

  double get radiusValue => switch (radius) {
        'sharp' => 2,
        'pill' => 20,
        _ => 10,
      };

  double get densityScale => switch (density) {
        'compact' => 0.92,
        'spacious' => 1.08,
        _ => 1.0,
      };

  static Color _hex(dynamic raw, Color fallback) {
    if (raw is! String) return fallback;
    var s = raw.trim();
    if (s.isEmpty) return fallback;
    if (s.startsWith('#')) s = s.substring(1);
    if (s.length == 3) {
      s = s.split('').map((c) => '$c$c').join();
    }
    if (s.length != 6) return fallback;
    final v = int.tryParse(s, radix: 16);
    if (v == null) return fallback;
    return Color(0xFF000000 | v);
  }
}
