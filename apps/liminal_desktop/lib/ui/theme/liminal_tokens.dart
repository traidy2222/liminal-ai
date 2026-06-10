import 'package:flutter/material.dart';

import '../../models/persona_ui_theme.dart';
import 'liminal_fonts.dart';

/// Resolved semantic colors for Liminal HUD chrome (web `personaVars.ts` parity).
class LiminalTokens {
  const LiminalTokens({
    required this.accent,
    required this.secondary,
    required this.warn,
    required this.danger,
    required this.success,
    required this.muted,
    required this.background,
    required this.surface,
    required this.panel,
    required this.text,
    required this.textMuted,
    required this.textDim,
    required this.border,
    required this.userBubble,
    required this.assistantAccent,
    required this.codeBackground,
    required this.radius,
    required this.displayLabel,
    required this.showGrid,
    required this.fontFamily,
    required this.fontFamilyMono,
    required this.fontFamilyHeading,
    required this.typeScale,
    required this.glow,
    required this.messageStyle,
    required this.shell,
    this.gradient,
  });

  final Color accent;
  final Color secondary;
  final Color warn;
  final Color danger;
  final Color success;
  final Color muted;
  final Color background;
  final Color surface;
  final Color panel;
  final Color text;
  final Color textMuted;
  final Color textDim;
  final Color border;
  final Color userBubble;
  final Color assistantAccent;
  final Color codeBackground;
  final double radius;
  final String displayLabel;
  final bool showGrid;
  final String? fontFamily;
  final String fontFamilyMono;
  final String? fontFamilyHeading;
  final double typeScale;
  final double glow;
  /// `bubble` | `flat` | `transcript` — how message rows are rendered.
  final String messageStyle;
  /// `hud` | `terminal` | `studio` | `minimal`.
  final String shell;
  final PersonaGradient? gradient;

  static const _bg = Color(0xFF020408);

  factory LiminalTokens.fromPersona(PersonaUiTheme persona, {LiminalFontSet? fonts}) {
    final f = fonts ?? LiminalFontSet.resolve(persona);
    final surface = persona.surfaceTint;
    // Hairline borders stay neutral with only a whisper of the persona accent —
    // accent-saturated borders belong to selection/focus states, not resting chrome.
    final hairline = Color.lerp(Colors.white, persona.accent, 0.30)!;
    return LiminalTokens(
      accent: persona.accent,
      secondary: persona.secondary,
      warn: persona.warn,
      danger: persona.danger,
      success: persona.success,
      muted: persona.muted,
      background: _bg,
      surface: surface,
      panel: Color.alphaBlend(Colors.white.withValues(alpha: 0.045), surface),
      text: const Color(0xFFE7EDF5),
      textMuted: persona.muted,
      textDim: const Color(0xFF73808F),
      border: hairline.withValues(alpha: 0.11),
      userBubble: persona.accent.withValues(alpha: 0.12),
      assistantAccent: persona.success,
      codeBackground: const Color(0xFF030810),
      radius: persona.radiusValue,
      displayLabel: persona.displayLabel,
      showGrid: persona.background == 'grid' &&
          persona.shell != 'minimal' &&
          persona.shell != 'terminal',
      shell: persona.shell,
      fontFamily: f.themeFontFamily,
      fontFamilyMono: f.monoFamily,
      fontFamilyHeading: f.headingFamily,
      typeScale: persona.typeScale,
      glow: persona.glowIntensity ?? 0.35,
      messageStyle: persona.messageStyle,
      gradient: persona.gradient,
    );
  }

  static LiminalTokens get defaultTokens =>
      LiminalTokens.fromPersona(PersonaUiTheme.liminalDefault);

  // ---- Derived state colors (computed, so persona themes get them free) ----

  /// Foreground for solid-accent fills — black on bright accents, white on dark.
  Color get onAccent =>
      accent.computeLuminance() > 0.45 ? const Color(0xFF06090E) : Colors.white;

  /// One step above [surface] — hovered cards, raised tiles.
  Color get surfaceRaised =>
      Color.alphaBlend(Colors.white.withValues(alpha: 0.05), surface);

  /// Opaque popover/dialog/menu surface (sits above everything).
  Color get overlay =>
      Color.alphaBlend(Colors.white.withValues(alpha: 0.07), surface);

  /// Stronger hairline for hovered or emphasized containers.
  Color get borderStrong =>
      Color.lerp(Colors.white, accent, 0.30)!.withValues(alpha: 0.22);

  /// Accent-saturated border — selection and focus only.
  Color get accentBorder => accent.withValues(alpha: 0.50);

  /// Flat hover wash for rows, icon buttons, list items.
  Color get hoverOverlay => Colors.white.withValues(alpha: 0.045);

  /// Pressed-state wash.
  Color get pressedOverlay => Colors.white.withValues(alpha: 0.08);

  TextStyle monoStyle({
    double fontSize = 13,
    Color? color,
    FontWeight? fontWeight,
    double? height,
  }) {
    return TextStyle(
      fontFamily: fontFamilyMono,
      fontSize: fontSize,
      color: color ?? textMuted,
      fontWeight: fontWeight,
      height: height ?? 1.4,
    );
  }
}
