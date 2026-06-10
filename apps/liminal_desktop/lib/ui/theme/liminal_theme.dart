import 'dart:math' as math;

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

  // Controls cap the persona radius so pill/sharp personas restyle chrome
  // without producing capsule buttons or zero-radius menus.
  final controlRadius = math.min(math.max(tokens.radius, 6.0), 12.0);

  final colorScheme = ColorScheme.dark(
    primary: tokens.accent,
    secondary: tokens.secondary,
    tertiary: tokens.success,
    surface: tokens.surface,
    error: tokens.danger,
    onPrimary: tokens.onAccent,
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
    // Desktop feel: flat state washes instead of mobile ink ripples.
    splashFactory: NoSplash.splashFactory,
    hoverColor: tokens.hoverOverlay,
    focusColor: tokens.accent.withValues(alpha: 0.18),
    highlightColor: tokens.pressedOverlay,
    splashColor: Colors.transparent,
    appBarTheme: AppBarTheme(
      centerTitle: false,
      elevation: 0,
      scrolledUnderElevation: 0,
      backgroundColor: tokens.panel.withValues(alpha: 0.92),
      foregroundColor: tokens.text,
      shape: Border(bottom: BorderSide(color: tokens.border)),
      titleTextStyle: fonts.heading(
        fontSize: 16 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: -0.2,
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
      fillColor: Colors.white.withValues(alpha: 0.035),
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
        borderRadius: BorderRadius.circular(controlRadius),
        borderSide: BorderSide(color: tokens.border),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        borderSide: BorderSide(color: tokens.border),
      ),
      hoverColor: Colors.white.withValues(alpha: 0.02),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        borderSide: BorderSide(color: tokens.accent.withValues(alpha: 0.75), width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        borderSide: BorderSide(color: tokens.danger),
      ),
    ),
    dropdownMenuTheme: DropdownMenuThemeData(textStyle: inputBase),
    tabBarTheme: TabBarThemeData(
      labelColor: tokens.text,
      unselectedLabelColor: tokens.textMuted,
      indicatorColor: tokens.accent,
      indicatorSize: TabBarIndicatorSize.label,
      dividerColor: tokens.border,
      overlayColor: WidgetStatePropertyAll(tokens.hoverOverlay),
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
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) {
            return tokens.surfaceRaised.withValues(alpha: 0.6);
          }
          if (states.contains(WidgetState.pressed)) {
            return Color.alphaBlend(Colors.black.withValues(alpha: 0.18), tokens.accent);
          }
          if (states.contains(WidgetState.hovered)) {
            return Color.alphaBlend(Colors.white.withValues(alpha: 0.10), tokens.accent);
          }
          return tokens.accent;
        }),
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return tokens.textDim;
          return tokens.onAccent;
        }),
        elevation: const WidgetStatePropertyAll(0),
        textStyle: WidgetStatePropertyAll(
          fonts.body(fontWeight: FontWeight.w600, fontSize: 13 * scale, letterSpacing: 0.1),
        ),
        padding: WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 18 * scale, vertical: 12 * scale),
        ),
        minimumSize: const WidgetStatePropertyAll(Size(0, 40)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(controlRadius)),
        ),
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return tokens.textDim;
          return tokens.text;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return Colors.transparent;
          if (states.contains(WidgetState.pressed)) return tokens.pressedOverlay;
          if (states.contains(WidgetState.hovered)) return tokens.hoverOverlay;
          return Colors.white.withValues(alpha: 0.02);
        }),
        side: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.hovered) || states.contains(WidgetState.focused)) {
            return BorderSide(color: tokens.borderStrong);
          }
          return BorderSide(color: tokens.border);
        }),
        elevation: const WidgetStatePropertyAll(0),
        textStyle: WidgetStatePropertyAll(
          fonts.body(fontWeight: FontWeight.w500, fontSize: 13 * scale),
        ),
        padding: WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 16 * scale, vertical: 12 * scale),
        ),
        minimumSize: const WidgetStatePropertyAll(Size(0, 40)),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(controlRadius)),
        ),
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: ButtonStyle(
        foregroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.disabled)) return tokens.textDim;
          if (states.contains(WidgetState.hovered) || states.contains(WidgetState.focused)) {
            return tokens.text;
          }
          return tokens.textMuted;
        }),
        backgroundColor: WidgetStateProperty.resolveWith((states) {
          if (states.contains(WidgetState.pressed)) return tokens.pressedOverlay;
          if (states.contains(WidgetState.hovered)) return tokens.hoverOverlay;
          return Colors.transparent;
        }),
        textStyle: WidgetStatePropertyAll(
          fonts.body(fontWeight: FontWeight.w500, fontSize: 13 * scale),
        ),
        padding: WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 12 * scale, vertical: 10 * scale),
        ),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(borderRadius: BorderRadius.circular(controlRadius)),
        ),
        overlayColor: const WidgetStatePropertyAll(Colors.transparent),
      ),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white.withValues(alpha: 0.04),
      selectedColor: tokens.accent.withValues(alpha: 0.14),
      disabledColor: tokens.surface.withValues(alpha: 0.25),
      labelStyle: fonts.body(fontSize: 12 * scale, color: tokens.textMuted),
      secondaryLabelStyle: fonts.body(fontSize: 12 * scale, color: tokens.accent),
      side: BorderSide(color: tokens.border),
      selectedShadowColor: Colors.transparent,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(controlRadius),
      ),
      padding: EdgeInsets.symmetric(horizontal: 8 * scale, vertical: 2 * scale),
    ),
    popupMenuTheme: PopupMenuThemeData(
      color: tokens.overlay,
      surfaceTintColor: Colors.transparent,
      elevation: 12,
      shadowColor: Colors.black.withValues(alpha: 0.5),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        side: BorderSide(color: tokens.borderStrong),
      ),
      textStyle: fonts.body(fontSize: 13 * scale, color: tokens.text),
      labelTextStyle: WidgetStatePropertyAll(
        fonts.body(fontSize: 13 * scale, color: tokens.text),
      ),
    ),
    menuTheme: MenuThemeData(
      style: MenuStyle(
        backgroundColor: WidgetStatePropertyAll(tokens.overlay),
        surfaceTintColor: const WidgetStatePropertyAll(Colors.transparent),
        elevation: const WidgetStatePropertyAll(12),
        shape: WidgetStatePropertyAll(
          RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(controlRadius),
            side: BorderSide(color: tokens.borderStrong),
          ),
        ),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: tokens.overlay,
      surfaceTintColor: Colors.transparent,
      elevation: 24,
      shadowColor: Colors.black.withValues(alpha: 0.55),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(math.max(tokens.radius, 12.0)),
        side: BorderSide(color: tokens.borderStrong),
      ),
      titleTextStyle: fonts.heading(
        fontSize: 17 * scale,
        fontWeight: FontWeight.w600,
        color: tokens.text,
        letterSpacing: -0.2,
      ),
      contentTextStyle: fonts.body(fontSize: 14 * scale, color: tokens.textMuted, height: 1.45),
    ),
    tooltipTheme: TooltipThemeData(
      waitDuration: const Duration(milliseconds: 350),
      decoration: BoxDecoration(
        color: tokens.overlay,
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: tokens.borderStrong),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.4),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      textStyle: fonts.body(fontSize: 12 * scale, color: tokens.text),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
    ),
    scrollbarTheme: ScrollbarThemeData(
      thickness: const WidgetStatePropertyAll(8),
      radius: const Radius.circular(4),
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.hovered) || states.contains(WidgetState.dragged)) {
          return Colors.white.withValues(alpha: 0.28);
        }
        return Colors.white.withValues(alpha: 0.14);
      }),
      trackColor: const WidgetStatePropertyAll(Colors.transparent),
      crossAxisMargin: 2,
      mainAxisMargin: 4,
    ),
    switchTheme: SwitchThemeData(
      thumbColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return tokens.onAccent;
        return tokens.textMuted;
      }),
      trackColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return tokens.accent;
        return Colors.white.withValues(alpha: 0.08);
      }),
      trackOutlineColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return Colors.transparent;
        return tokens.borderStrong;
      }),
    ),
    checkboxTheme: CheckboxThemeData(
      fillColor: WidgetStateProperty.resolveWith((states) {
        if (states.contains(WidgetState.selected)) return tokens.accent;
        return Colors.transparent;
      }),
      checkColor: WidgetStatePropertyAll(tokens.onAccent),
      side: BorderSide(color: tokens.borderStrong, width: 1.5),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(4)),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: tokens.overlay,
      contentTextStyle: fonts.body(color: tokens.text),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(controlRadius),
        side: BorderSide(color: tokens.borderStrong),
      ),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: tokens.accent,
      linearTrackColor: Colors.white.withValues(alpha: 0.06),
    ),
    iconTheme: IconThemeData(color: tokens.textMuted),
  );
}
