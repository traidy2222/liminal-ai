import 'package:flutter/animation.dart';

/// Motion presets scaled by persona [motionScale].
abstract final class LiminalMotion {
  static const Duration fast = Duration(milliseconds: 120);
  static const Duration normal = Duration(milliseconds: 200);
  static const Duration slow = Duration(milliseconds: 320);

  static Duration scaled(Duration base, double motionScale) {
    final ms = (base.inMilliseconds * motionScale).round().clamp(60, 600);
    return Duration(milliseconds: ms);
  }

  static Curve get standard => Curves.easeOutCubic;
  static Curve get enter => Curves.easeOut;
  static Curve get exit => Curves.easeIn;
}
