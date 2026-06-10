import 'package:flutter/material.dart';

/// Responsive layout helpers for desktop window sizes.
abstract final class LiminalBreakpoints {
  static const double compact = 600;
  static const double medium = 900;
  static const double expanded = 1200;
  static const double wide = 1600;

  static double horizontalInset(double width) {
    if (width >= wide) return 56;
    if (width >= expanded) return 40;
    if (width >= medium) return 28;
    return 16;
  }

  /// Usable content width (fills window minus inset, capped on ultra-wide).
  static double contentMaxWidth(double width) {
    final inset = horizontalInset(width);
    final available = width - inset * 2;
    if (width >= wide) return available.clamp(0, 1560);
    if (width >= expanded) return available.clamp(0, 1280);
    return available;
  }

  static int settingsColumns(double width) {
    if (width >= expanded) return 2;
    return 1;
  }

  static EdgeInsets pagePadding(BuildContext context) {
    final w = MediaQuery.sizeOf(context).width;
    final h = horizontalInset(w);
    return EdgeInsets.fromLTRB(h, 20, h, 24);
  }
}
