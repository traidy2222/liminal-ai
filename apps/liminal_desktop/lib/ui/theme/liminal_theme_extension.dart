import 'package:flutter/material.dart';

import 'liminal_tokens.dart';

/// Theme extension for Liminal semantic colors (use `LiminalTheme.of(context)`).
class LiminalThemeExtension extends ThemeExtension<LiminalThemeExtension> {
  const LiminalThemeExtension(this.tokens);

  final LiminalTokens tokens;

  static LiminalThemeExtension of(BuildContext context) {
    return Theme.of(context).extension<LiminalThemeExtension>() ??
        LiminalThemeExtension(LiminalTokens.defaultTokens);
  }

  @override
  LiminalThemeExtension copyWith({LiminalTokens? tokens}) {
    return LiminalThemeExtension(tokens ?? this.tokens);
  }

  @override
  LiminalThemeExtension lerp(
    covariant ThemeExtension<LiminalThemeExtension>? other,
    double t,
  ) {
    if (other is! LiminalThemeExtension) return this;
    return t < 0.5 ? this : other;
  }
}

/// Shorthand for [LiminalThemeExtension.of].
abstract final class LiminalTheme {
  static LiminalTokens of(BuildContext context) => LiminalThemeExtension.of(context).tokens;

  /// Monospace / HUD labels — always uses the persona mono stack.
  static TextStyle mono(
    BuildContext context, {
    double fontSize = 13,
    Color? color,
    FontWeight? fontWeight,
  }) {
    return of(context).monoStyle(
      fontSize: fontSize,
      color: color,
      fontWeight: fontWeight,
    );
  }
}
