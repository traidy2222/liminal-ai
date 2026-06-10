import 'package:flutter/material.dart';

import '../../theme/liminal_theme_extension.dart';

/// Named text styles on top of [ThemeData] + persona tokens.
abstract final class LiminalTypography {
  static TextStyle pageTitle(BuildContext context) =>
      Theme.of(context).textTheme.headlineSmall!.copyWith(
            color: LiminalTheme.of(context).text,
            fontWeight: FontWeight.w600,
          );

  static TextStyle sectionTitle(BuildContext context) =>
      Theme.of(context).textTheme.titleMedium!.copyWith(
            color: LiminalTheme.of(context).text,
            fontWeight: FontWeight.w600,
            letterSpacing: -0.1,
          );

  static TextStyle body(BuildContext context, {Color? color}) =>
      Theme.of(context).textTheme.bodyMedium!.copyWith(
            color: color ?? LiminalTheme.of(context).textMuted,
            height: 1.4,
          );

  static TextStyle caption(BuildContext context) =>
      Theme.of(context).textTheme.bodySmall!.copyWith(
            color: LiminalTheme.of(context).textDim,
            height: 1.35,
          );

  static TextStyle label(BuildContext context, {Color? color}) =>
      Theme.of(context).textTheme.labelMedium!.copyWith(
            color: color ?? LiminalTheme.of(context).textMuted,
          );

  static TextStyle mono(
    BuildContext context, {
    double fontSize = 12,
    Color? color,
  }) =>
      LiminalTheme.mono(context, fontSize: fontSize, color: color);
}
