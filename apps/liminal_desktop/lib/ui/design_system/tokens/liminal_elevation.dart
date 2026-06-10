import 'package:flutter/material.dart';

/// Shadow and surface elevation scale (desktop HUD).
abstract final class LiminalElevation {
  static const double none = 0;
  static const double low = 1;
  static const double mid = 2;
  static const double high = 3;

  /// Layered ambient + key shadows. The persona accent contributes only a
  /// faint halo at high elevation — depth comes from neutral shadow, not glow.
  static List<BoxShadow> shadow(Color accent, {double level = mid, double glow = 0.35}) {
    final halo = accent.withValues(alpha: (0.04 + glow * 0.05).clamp(0.0, 0.12));
    return switch (level) {
      low => [
        BoxShadow(color: Colors.black.withValues(alpha: 0.20), blurRadius: 6, offset: const Offset(0, 1)),
        BoxShadow(color: Colors.black.withValues(alpha: 0.16), blurRadius: 16, offset: const Offset(0, 6)),
      ],
      high => [
        BoxShadow(color: Colors.black.withValues(alpha: 0.30), blurRadius: 10, offset: const Offset(0, 2)),
        BoxShadow(color: Colors.black.withValues(alpha: 0.40), blurRadius: 36, offset: const Offset(0, 16)),
        BoxShadow(color: halo, blurRadius: 28, spreadRadius: -8),
      ],
      _ => [
        BoxShadow(color: Colors.black.withValues(alpha: 0.24), blurRadius: 8, offset: const Offset(0, 2)),
        BoxShadow(color: Colors.black.withValues(alpha: 0.28), blurRadius: 24, offset: const Offset(0, 10)),
      ],
    };
  }
}
