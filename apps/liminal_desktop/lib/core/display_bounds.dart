import 'package:flutter/material.dart';
import 'package:screen_retriever/screen_retriever.dart';

/// True when [windowRect] overlaps any monitor (uses screen_retriever, not dart:ui Display).
Future<bool> windowOverlapsAnyDisplay({
  required double x,
  required double y,
  required double width,
  required double height,
}) async {
  try {
    final displays = await screenRetriever.getAllDisplays();
    if (displays.isEmpty) return true;

    final windowRect = Rect.fromLTWH(x, y, width, height);
    for (final display in displays) {
      final origin = display.visiblePosition ?? Offset.zero;
      final screenRect = Rect.fromLTWH(
        origin.dx,
        origin.dy,
        display.size.width,
        display.size.height,
      );
      if (screenRect.overlaps(windowRect)) {
        return true;
      }
    }
    return false;
  } catch (_) {
    return true;
  }
}
