import 'package:flutter/material.dart';

import '../../models/persona_ui_theme.dart';
import 'liminal_tokens.dart';

/// Bundled + platform font roles — mirrors web `resolveFontStacks` (`persona_ui_theme.ts`).
class LiminalFontSet {
  LiminalFontSet._({
    required this.body,
    required this.mono,
    required this.heading,
    required this.themeFontFamily,
    required this.monoFamily,
    required this.headingFamily,
  });

  static const inter = 'Inter';
  static const jetBrainsMono = 'JetBrains Mono';
  static const ibmPlexMono = 'IBM Plex Mono';

  final TextStyle Function({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
  }) body;

  final TextStyle Function({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
  }) mono;

  final TextStyle Function({
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
  }) heading;

  final String? themeFontFamily;
  final String monoFamily;
  final String? headingFamily;

  static LiminalFontSet resolve(PersonaUiTheme persona) {
    final pair = persona.fontPair;
    final typo = persona.typography;

    var bodyFamily = inter;
    var monoFamily = jetBrainsMono;
    var headingFamily = inter;

    switch (pair) {
      case 'ibm-plex':
        bodyFamily = inter;
        monoFamily = ibmPlexMono;
        headingFamily = inter;
      case 'jetbrains':
        bodyFamily = jetBrainsMono;
        monoFamily = jetBrainsMono;
        headingFamily = jetBrainsMono;
      case 'inter-cascadia':
      case 'geist':
        bodyFamily = inter;
        monoFamily = jetBrainsMono;
        headingFamily = inter;
      case 'playfair':
        bodyFamily = inter;
        monoFamily = jetBrainsMono;
        headingFamily = inter;
      case 'system':
        bodyFamily = '';
        monoFamily = jetBrainsMono;
        headingFamily = '';
    }

    if (typo == 'mono') {
      bodyFamily = monoFamily;
    }

    TextStyle bodyFn({
      double? fontSize,
      FontWeight? fontWeight,
      Color? color,
      double? height,
      double? letterSpacing,
    }) =>
        _style(
          bodyFamily,
          fontSize: fontSize,
          fontWeight: fontWeight,
          color: color,
          height: height,
          letterSpacing: letterSpacing,
        );

    TextStyle monoFn({
      double? fontSize,
      FontWeight? fontWeight,
      Color? color,
      double? height,
      double? letterSpacing,
    }) =>
        _style(
          monoFamily,
          fontSize: fontSize,
          fontWeight: fontWeight,
          color: color,
          height: height,
          letterSpacing: letterSpacing,
        );

    TextStyle headingFn({
      double? fontSize,
      FontWeight? fontWeight,
      Color? color,
      double? height,
      double? letterSpacing,
    }) =>
        _style(
          headingFamily.isEmpty ? bodyFamily : headingFamily,
          fontSize: fontSize,
          fontWeight: fontWeight ?? FontWeight.w600,
          color: color,
          height: height,
          letterSpacing: letterSpacing,
        );

    return LiminalFontSet._(
      body: bodyFn,
      mono: monoFn,
      heading: headingFn,
      themeFontFamily: bodyFamily.isEmpty ? null : bodyFamily,
      monoFamily: monoFamily,
      headingFamily: headingFamily.isEmpty ? null : headingFamily,
    );
  }

  static TextStyle _style(
    String family, {
    double? fontSize,
    FontWeight? fontWeight,
    Color? color,
    double? height,
    double? letterSpacing,
  }) {
    return TextStyle(
      fontFamily: family.isEmpty ? null : family,
      fontSize: fontSize,
      fontWeight: fontWeight,
      color: color,
      height: height,
      letterSpacing: letterSpacing,
    );
  }

  TextTheme textTheme(LiminalTokens tokens, double scale) {
    return TextTheme(
      displaySmall: heading(
        fontSize: 28 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: -0.5,
      ),
      headlineMedium: heading(
        fontSize: 22 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: -0.3,
      ),
      titleLarge: heading(
        fontSize: 18 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: -0.2,
      ),
      titleMedium: body(
        fontSize: 16 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: -0.1,
      ),
      titleSmall: body(
        fontSize: 14 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
      ),
      bodyLarge: body(
        fontSize: 15 * scale,
        color: tokens.text,
        height: 1.45,
      ),
      bodyMedium: body(
        fontSize: 14 * scale,
        color: tokens.text,
        height: 1.45,
      ),
      bodySmall: body(
        fontSize: 13 * scale,
        color: tokens.textMuted,
        height: 1.4,
      ),
      labelLarge: body(
        fontSize: 13 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: 0.1,
      ),
      labelMedium: body(
        fontSize: 12 * scale,
        fontWeight: FontWeight.w500,
        color: tokens.textMuted,
        letterSpacing: 0.1,
      ),
      labelSmall: mono(
        fontSize: 11 * scale,
        color: tokens.textDim,
        letterSpacing: 0.2,
      ),
    );
  }

  static Future<void> warmUp(PersonaUiTheme persona) async {
    resolve(persona);
  }
}
