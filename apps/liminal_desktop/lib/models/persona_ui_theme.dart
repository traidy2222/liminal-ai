import 'package:flutter/material.dart';

/// One stop in a structured persona gradient (mirrors core `PersonaGradientStop`).
class PersonaGradientStop {
  const PersonaGradientStop({required this.color, required this.at});

  final Color color;
  final double at;
}

/// Structured, cross-platform background gradient (mirrors core `PersonaGradient`).
class PersonaGradient {
  const PersonaGradient({required this.kind, this.angle, required this.stops});

  /// `linear` | `radial`.
  final String kind;
  final double? angle;
  final List<PersonaGradientStop> stops;

  List<Color> get colors => stops.map((s) => s.color).toList();
  List<double> get positions =>
      stops.map((s) => s.at.clamp(0.0, 1.0).toDouble()).toList();

  static PersonaGradient? fromJson(dynamic raw) {
    if (raw is! Map) return null;
    final kind = raw['kind'] == 'radial' ? 'radial' : raw['kind'] == 'linear' ? 'linear' : null;
    if (kind == null) return null;
    final rawStops = raw['stops'];
    if (rawStops is! List) return null;
    final stops = <PersonaGradientStop>[];
    for (final s in rawStops) {
      if (s is! Map) continue;
      final color = PersonaUiTheme._hex(s['color'], const Color(0x00000000));
      final atRaw = s['at'];
      final at = atRaw is num ? atRaw.toDouble() : null;
      if (at == null) continue;
      stops.add(PersonaGradientStop(color: color, at: at.clamp(0.0, 1.0).toDouble()));
    }
    if (stops.length < 2) return null;
    stops.sort((a, b) => a.at.compareTo(b.at));
    final angleRaw = raw['angle'];
    return PersonaGradient(
      kind: kind,
      angle: angleRaw is num ? angleRaw.toDouble() : null,
      stops: stops,
    );
  }
}

/// Persona UI theme — mirrors `@liminal/core` `PersonaUiTheme` (V2 + Phase-1 open tokens).
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
    this.headerStyle = 'bar',
    this.panelLayout = 'both',
    this.inputDock = 'bottom-bar',
    // Open-token overrides (null = derive from the enum above).
    this.densityScaleOverride,
    this.radiusPxOverride,
    this.motionScaleOverride,
    this.typeScaleOverride,
    this.glowIntensity,
    this.gradient,
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
  final String headerStyle;
  final String panelLayout;
  final String inputDock;

  // Open tokens (Phase 1). When non-null, take precedence over the enum.
  final double? densityScaleOverride;
  final double? radiusPxOverride;
  final double? motionScaleOverride;
  final double? typeScaleOverride;
  final double? glowIntensity;
  final PersonaGradient? gradient;

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
      headerStyle: json['headerStyle'] as String? ?? liminalDefault.headerStyle,
      panelLayout: json['panelLayout'] as String? ?? liminalDefault.panelLayout,
      inputDock: json['inputDock'] as String? ?? liminalDefault.inputDock,
      densityScaleOverride: _clampNum(json['densityScale'], 0.8, 1.25),
      radiusPxOverride: _clampNum(json['radiusPx'], 0, 28),
      motionScaleOverride: _clampNum(json['motionScale'], 0.4, 1.6),
      typeScaleOverride: _clampNum(json['typeScale'], 0.85, 1.3),
      glowIntensity: _clampNum(json['glowIntensity'], 0, 1),
      gradient: PersonaGradient.fromJson(json['gradient']),
    );
  }

  /// Corner radius in px — open token if set, else derived from the enum.
  double get radiusValue {
    if (radiusPxOverride != null) return radiusPxOverride!;
    return switch (radius) {
      'sharp' => 2,
      'pill' => 20,
      _ => 10,
    };
  }

  /// Spacing multiplier — open token if set, else derived from the enum.
  double get densityScale {
    if (densityScaleOverride != null) return densityScaleOverride!;
    return switch (density) {
      'compact' => 0.92,
      'spacious' => 1.08,
      _ => 1.0,
    };
  }

  /// Global font-size multiplier — open token if set, else 1.0.
  double get typeScale => typeScaleOverride ?? 1.0;

  /// Global motion multiplier — open token if set, else 1.0 (preset baseline).
  double get motionScale => motionScaleOverride ?? 1.0;

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

  static double? _clampNum(dynamic raw, double min, double max) {
    final n = raw is num ? raw.toDouble() : (raw is String ? double.tryParse(raw) : null);
    if (n == null || n.isNaN || n.isInfinite) return null;
    return n.clamp(min, max).toDouble();
  }
}
