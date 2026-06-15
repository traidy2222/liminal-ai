import 'package:flutter/material.dart';
import 'package:window_manager/window_manager.dart';

import '../core/display_bounds.dart';
import '../models/liminal_app_spec.dart';
import 'app_window_args.dart';

Future<void> applyWidgetWindowChrome({
  required LiminalAppShell shell,
  required int width,
  required int height,
  double? x,
  double? y,
  String? title,
}) async {
  await windowManager.ensureInitialized();

  final frameless = shell.frameless && shell.isWidget;
  final size = Size(width.clamp(200, 1200).toDouble(), height.clamp(150, 900).toDouble());

  final hasValidPosition = x != null &&
      y != null &&
      await windowOverlapsAnyDisplay(
        x: x,
        y: y,
        width: size.width,
        height: size.height,
      );

  final options = WindowOptions(
    size: size,
    minimumSize: Size(size.width * 0.85, size.height * 0.85),
    center: !hasValidPosition,
    title: title ?? 'Liminal',
    titleBarStyle: frameless ? TitleBarStyle.hidden : TitleBarStyle.normal,
    windowButtonVisibility: !frameless,
    alwaysOnTop: shell.alwaysOnTop,
    skipTaskbar: shell.skipTaskbar,
    backgroundColor: frameless ? Colors.transparent : const Color(0xFF0A0E14),
  );

  await windowManager.waitUntilReadyToShow(options, () async {
    await windowManager.setSize(size);
    if (hasValidPosition) {
      await windowManager.setPosition(Offset(x!, y!));
    }
    if (shell.opacity < 1) {
      await windowManager.setOpacity(shell.opacity.clamp(0.5, 1));
    }
    await windowManager.setAlwaysOnTop(shell.alwaysOnTop);
  });
}

Future<void> applyChromeFromLaunchArgs(AppWindowLaunchArgs args) async {
  await applyWidgetWindowChrome(
    shell: args.effectiveShell,
    width: args.effectiveWidth,
    height: args.effectiveHeight,
    x: args.placementX,
    y: args.placementY,
    title: args.title,
  );
}

Future<void> applyChromeFromSpec(LiminalAppSpec spec) async {
  await applyWidgetWindowChrome(
    shell: spec.shell,
    width: spec.effectiveWidth,
    height: spec.effectiveHeight,
    x: spec.placementX,
    y: spec.placementY,
    title: spec.title,
  );
}

Future<void> hideCurrentAppWindow() async {
  await windowManager.hide();
}
