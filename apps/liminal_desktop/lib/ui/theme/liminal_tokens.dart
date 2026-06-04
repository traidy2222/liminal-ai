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

  static const _bg = Color(0xFF020408);

  factory LiminalTokens.fromPersona(PersonaUiTheme persona, {LiminalFontSet? fonts}) {
    final f = fonts ?? LiminalFontSet.resolve(persona);
    final surface = persona.surfaceTint;
    return LiminalTokens(
      accent: persona.accent,
      secondary: persona.secondary,
      warn: persona.warn,
      danger: persona.danger,
      success: persona.success,
      muted: persona.muted,
      background: _bg,
      surface: surface,
      panel: Color.alphaBlend(Colors.white.withValues(alpha: 0.04), surface),
      text: const Color(0xFFC8D4E0),
      textMuted: persona.muted,
      textDim: const Color(0xFF667788),
      border: persona.accent.withValues(alpha: 0.18),
      userBubble: persona.accent.withValues(alpha: 0.12),
      assistantAccent: persona.success,
      codeBackground: const Color(0xFF030810),
      radius: persona.radiusValue,
      displayLabel: persona.displayLabel,
      showGrid: persona.background == 'grid' && persona.shell != 'minimal',
      fontFamily: f.themeFontFamily,
      fontFamilyMono: f.monoFamily,
      fontFamilyHeading: f.headingFamily,
    );
  }

  static LiminalTokens get defaultTokens =>
      LiminalTokens.fromPersona(PersonaUiTheme.liminalDefault);

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
