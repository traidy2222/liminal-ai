import 'package:flutter/material.dart';

import '../../models/persona_ui_theme.dart';
import 'liminal_fonts.dart';
import 'liminal_theme_extension.dart';
import 'liminal_tokens.dart';

ThemeData buildLiminalTheme({PersonaUiTheme? persona}) {
  final p = persona ?? PersonaUiTheme.liminalDefault;
  final fonts = LiminalFontSet.resolve(p);
  final tokens = LiminalTokens.fromPersona(p, fonts: fonts);
  final scale = p.densityScale;
  // Font sizing combines density with the persona's open type-scale token, so
  // a "spacious + larger type" persona reads distinctly from a tight one.
  final textScale = scale * p.typeScale;
  final baseText = fonts.textTheme(tokens, textScale);

  final colorScheme = ColorScheme.dark(
    primary: tokens.accent,
    secondary: tokens.secondary,
    tertiary: tokens.success,
    surface: tokens.surface,
    error: tokens.danger,
    onPrimary: Colors.black,
    onSecondary: Colors.white,
    onSurface: tokens.text,
    outline: tokens.border,
  );

  final inputBase = fonts.body(fontSize: 14 * scale, color: tokens.text);
  final hintBase = fonts.body(fontSize: 14 * scale, color: tokens.textDim);

  return ThemeData(
    useMaterial3: true,
    brightness: Brightness.dark,
    colorScheme: colorScheme,
    scaffoldBackgroundColor: tokens.background,
    fontFamily: tokens.fontFamily,
    textTheme: baseText,
    primaryTextTheme: baseText,
    extensions: [LiminalThemeExtension(tokens)],
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: tokens.panel.withValues(alpha: 0.92),
      foregroundColor: tokens.text,
      titleTextStyle: fonts.heading(
        fontSize: 16 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
      ),
    ),
    drawerTheme: DrawerThemeData(
      backgroundColor: tokens.panel,
      surfaceTintColor: Colors.transparent,
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: tokens.surface.withValues(alpha: 0.88),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(tokens.radius),
        side: BorderSide(color: tokens.border),
      ),
    ),
    dividerTheme: DividerThemeData(color: tokens.border, thickness: 1),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: tokens.surface.withValues(alpha: 0.65),
      floatingLabelBehavior: FloatingLabelBehavior.never,
      isDense: false,
      contentPadding: EdgeInsets.symmetric(
        horizontal: 16 * scale,
        vertical: 14 * scale,
      ),
      constraints: const BoxConstraints(minHeight: 52),
      hintStyle: hintBase,
      labelStyle: fonts.body(fontSize: 13 * scale, color: tokens.textMuted),
      helperStyle: fonts.body(fontSize: 12 * scale, color: tokens.textDim, height: 1.35),
      helperMaxLines: 4,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(tokens.radius),
        borderSide: BorderSide(color: tokens.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(tokens.radius),
        borderSide: BorderSide(color: tokens.border),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(tokens.radius),
        borderSide: BorderSide(color: tokens.accent, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(tokens.radius),
        borderSide: BorderSide(color: tokens.danger),
      ),
    ),
    dropdownMenuTheme: DropdownMenuThemeData(textStyle: inputBase),
    tabBarTheme: TabBarThemeData(
      labelColor: tokens.accent,
      unselectedLabelColor: tokens.textMuted,
      indicatorColor: tokens.accent,
      dividerColor: tokens.border,
      labelPadding: const EdgeInsets.symmetric(horizontal: 14),
      labelStyle: fonts.body(
        fontSize: 14 * scale,
        fontWeight: FontWeight.w600,
      ),
      unselectedLabelStyle: fonts.body(
        fontSize: 14 * scale,
        fontWeight: FontWeight.w500,
        color: tokens.textMuted,
      ),
    ),
    listTileTheme: const ListTileThemeData(
      contentPadding: EdgeInsets.symmetric(horizontal: 4, vertical: 2),
      minVerticalPadding: 8,
      dense: false,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: tokens.accent.withValues(alpha: 0.14),
        foregroundColor: tokens.accent,
        disabledBackgroundColor: tokens.surface.withValues(alpha: 0.35),
        disabledForegroundColor: tokens.textDim,
        elevation: 0,
        textStyle: fonts.body(fontWeight: FontWeight.w600, fontSize: 13 * scale),
        padding: EdgeInsets.symmetric(horizontal: 16 * scale, vertical: 12 * scale),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(tokens.radius),
          side: BorderSide(color: tokens.accent.withValues(alpha: 0.22)),
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        foregroundColor: tokens.text,
        disabledForegroundColor: tokens.textDim,
        backgroundColor: tokens.surface.withValues(alpha: 0.35),
        side: BorderSide(color: tokens.border),
        elevation: 0,
        textStyle: fonts.body(fontWeight: FontWeight.w500, fontSize: 13 * scale),
        padding: EdgeInsets.symmetric(horizontal: 16 * scale, vertical: 12 * scale),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(tokens.radius),
        ),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: tokens.textMuted,
        disabledForegroundColor: tokens.textDim,
        textStyle: fonts.body(fontWeight: FontWeight.w500, fontSize: 13 * scale),
        padding: EdgeInsets.symmetric(horizontal: 12 * scale, vertical: 10 * scale),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: tokens.surface.withValues(alpha: 0.45),
      selectedColor: tokens.accent.withValues(alpha: 0.12),
      disabledColor: tokens.surface.withValues(alpha: 0.25),
      labelStyle: fonts.body(fontSize: 12 * scale, color: tokens.textMuted),
      secondaryLabelStyle: fonts.body(fontSize: 12 * scale, color: tokens.accent),
      side: BorderSide(color: tokens.border),
      selectedShadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(tokens.radius),
      ),
      padding: EdgeInsets.symmetric(horizontal: 8 * scale, vertical: 2 * scale),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: tokens.panel,
      contentTextStyle: fonts.body(color: tokens.text),
      behavior: SnackBarBehavior.floating,
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(color: tokens.accent),
    iconTheme: IconThemeData(color: tokens.textMuted),
  );
}
