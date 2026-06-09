import 'package:flutter/material.dart';

/// Shadow and surface elevation scale (desktop HUD).
abstract final class LiminalElevation {
  static const double none = 0;
  static const double low = 1;
  static const double mid = 2;
  static const double high = 3;

  static List<BoxShadow> shadow(Color accent, {double level = mid, double glow = 0.35}) {
    final a = accent.withValues(alpha: 0.08 + glow * 0.06);
    return switch (level) {
      low => [
        BoxShadow(color: Colors.black.withValues(alpha: 0.25), blurRadius: 8, offset: const Offset(0, 2)),
      ],
      high => [
        BoxShadow(color: Colors.black.withValues(alpha: 0.45), blurRadius: 24, offset: const Offset(0, 8)),
        BoxShadow(color: a, blurRadius: 16, spreadRadius: -4),
      ],
      _ => [
        BoxShadow(color: Colors.black.withValues(alpha: 0.35), blurRadius: 14, offset: const Offset(0, 4)),
        BoxShadow(color: a, blurRadius: 10, spreadRadius: -6),
      ],
    };
  }
}
