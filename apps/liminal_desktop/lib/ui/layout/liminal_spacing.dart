import 'package:flutter/material.dart';

/// Spacing scale — single source for padding/gaps (8pt grid).
abstract final class LiminalSpacing {
  static const double xxs = 4;
  static const double xs = 8;
  static const double sm = 12;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;

  static const pagePadding = EdgeInsets.symmetric(horizontal: md, vertical: lg);
  static const sectionGap = SizedBox(height: lg);
  static const fieldGap = SizedBox(height: md);
  static const tightGap = SizedBox(height: sm);

  /// Soft cap for centered forms (onboarding); settings use [LiminalPageCanvas].
  static const double maxFormWidth = 640;
  static const double minTouchTarget = 48;
}
