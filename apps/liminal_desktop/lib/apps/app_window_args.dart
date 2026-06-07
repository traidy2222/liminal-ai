import 'dart:convert';

import '../models/liminal_app_spec.dart';

/// Payload passed as [WindowConfiguration.arguments] when opening a sub-window.
class AppWindowLaunchArgs {
  const AppWindowLaunchArgs({
    required this.appId,
    this.shell,
    this.placementWidth,
    this.placementHeight,
    this.placementX,
    this.placementY,
    this.title,
  });

  final String appId;
  final LiminalAppShell? shell;
  final int? placementWidth;
  final int? placementHeight;
  final double? placementX;
  final double? placementY;
  final String? title;

  factory AppWindowLaunchArgs.fromSpec(LiminalAppSpec spec) {
    return AppWindowLaunchArgs(
      appId: spec.id,
      shell: spec.shell,
      placementWidth: spec.placementWidth,
      placementHeight: spec.placementHeight,
      placementX: spec.placementX,
      placementY: spec.placementY,
      title: spec.title,
    );
  }

  factory AppWindowLaunchArgs.parse(String raw) {
    final trimmed = raw.trim();
    if (trimmed.isEmpty || trimmed == 'main') {
      return const AppWindowLaunchArgs(appId: '');
    }
    if (trimmed.startsWith('{')) {
      try {
        final decoded = jsonDecode(trimmed);
        if (decoded is Map) {
          final map = Map<String, dynamic>.from(decoded);
          final placement = map['placement'];
          return AppWindowLaunchArgs(
            appId: map['id'] as String? ?? map['appId'] as String? ?? '',
            title: map['title'] as String?,
            shell: LiminalAppShell.fromJson(
              map['shell'] is Map
                  ? Map<String, dynamic>.from(map['shell'] as Map)
                  : null,
            ),
            placementWidth: placement is Map
                ? (placement['width'] as num?)?.toInt()
                : null,
            placementHeight: placement is Map
                ? (placement['height'] as num?)?.toInt()
                : null,
            placementX:
                placement is Map ? (placement['x'] as num?)?.toDouble() : null,
            placementY:
                placement is Map ? (placement['y'] as num?)?.toDouble() : null,
          );
        }
      } catch (_) {
        /* fall through */
      }
    }
    return AppWindowLaunchArgs(appId: trimmed);
  }

  String encode() => jsonEncode({
        'id': appId,
        if (title != null) 'title': title,
        if (shell != null) 'shell': shell!.toJson(),
        if (placementWidth != null && placementHeight != null)
          'placement': {
            'width': placementWidth,
            'height': placementHeight,
            if (placementX != null) 'x': placementX,
            if (placementY != null) 'y': placementY,
          },
      });

  LiminalAppShell get effectiveShell => shell ?? LiminalAppShell.widgetDefaults();

  int get effectiveWidth => placementWidth ?? 320;
  int get effectiveHeight => placementHeight ?? 280;

  /// True when arguments JSON included shell or placement (not legacy id-only).
  bool get hasEmbeddedChrome =>
      shell != null ||
      (placementWidth != null && placementHeight != null);
}
