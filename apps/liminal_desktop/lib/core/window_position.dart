import 'dart:convert';
import 'dart:io';
import 'dart:ui' as ui;

import 'package:path/path.dart' as p;
import 'package:window_manager/window_manager.dart';

class WindowPosition {
  const WindowPosition({
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.isMaximized = false,
  });

  final int x;
  final int y;
  final int width;
  final int height;
  final bool isMaximized;

  factory WindowPosition.fromJson(Map<String, dynamic> json) {
    return WindowPosition(
      x: (json['x'] as num?)?.toInt() ?? 100,
      y: (json['y'] as num?)?.toInt() ?? 100,
      width: (json['width'] as num?)?.toInt() ?? 1280,
      height: (json['height'] as num?)?.toInt() ?? 720,
      isMaximized: json['isMaximized'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() => {
        'x': x,
        'y': y,
        'width': width,
        'height': height,
        'isMaximized': isMaximized,
      };

  static const String _fileName = 'window_state.json';

  static String get _filePath {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    return p.join(home, '.liminal', _fileName);
  }

  static Future<WindowPosition?> load() async {
    try {
      final file = File(_filePath);
      if (!await file.exists()) return null;
      final contents = await file.readAsString();
      if (contents.trim().isEmpty) return null;
      final decoded = jsonDecode(contents);
      if (decoded is! Map<String, dynamic>) return null;
      return WindowPosition.fromJson(decoded);
    } catch (_) {
      return null;
    }
  }

  static Future<void> save(WindowPosition position) async {
    try {
      final file = File(_filePath);
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode(position.toJson()));
    } catch (_) {}
  }

  static Future<void> clear() async {
    try {
      final file = File(_filePath);
      if (await file.exists()) {
        await file.delete();
      }
    } catch (_) {}
  }

  Offset get offset => ui.Offset(x.toDouble(), y.toDouble());
  Size get size => ui.Size(width.toDouble(), height.toDouble());
}

class WindowPositionManager with WindowListener {
  WindowPositionManager();

  WindowPosition? _lastPosition;
  bool _initialized = false;
  bool _ignoreNextMove = false;

  Future<void> initialize() async {
    if (_initialized) return;
    _initialized = true;

    await windowManager.ensureInitialized();

    final saved = await WindowPosition.load();
    if (saved != null && _isValidPosition(saved)) {
      _lastPosition = saved;
      _ignoreNextMove = true;
      await windowManager.setPosition(saved.offset);
      await windowManager.setSize(saved.size);
      if (saved.isMaximized) {
        await windowManager.maximize();
      }
      await windowManager.show();
    } else {
      await windowManager.center();
      await windowManager.show();
    }

    windowManager.addListener(this);
  }

  bool _isValidPosition(WindowPosition pos) {
    try {
      final displays = ui.PlatformDispatcher.instance.displays;
      if (displays.isEmpty) return false;

      final windowRect = ui.Rect.fromLTWH(
        pos.x.toDouble(),
        pos.y.toDouble(),
        pos.width.toDouble(),
        pos.height.toDouble(),
      );

      for (final display in displays) {
        final screenRect = ui.Rect.fromLTWH(
          display.visiblePosition.dx,
          display.visiblePosition.dy,
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

  Future<void> saveCurrentPosition() async {
    try {
      final position = await windowManager.getPosition();
      final size = await windowManager.getSize();
      final isMaximized = await windowManager.isMaximized();

      final pos = WindowPosition(
        x: position.dx.round(),
        y: position.dy.round(),
        width: size.width.round(),
        height: size.height.round(),
        isMaximized: isMaximized,
      );

      _lastPosition = pos;
      await WindowPosition.save(pos);
    } catch (_) {}
  }

  @override
  void onWindowMoved() {
    if (_ignoreNextMove) {
      _ignoreNextMove = false;
      return;
    }
    saveCurrentPosition();
  }

  @override
  void onWindowResized() {
    saveCurrentPosition();
  }

  @override
  void onWindowMaximize() {
    saveCurrentPosition();
  }

  @override
  void onWindowUnmaximize() {
    saveCurrentPosition();
  }

  @override
  void onWindowClose() async {
    await saveCurrentPosition();
    await windowManager.destroy();
  }

  @override
  void onWindowFocus() {}

  @override
  void onWindowBlur() {}

  @override
  void onWindowMinimize() {}

  @override
  void onWindowRestore() {}

  @override
  void onWindowEvent(String eventName) {}
}
