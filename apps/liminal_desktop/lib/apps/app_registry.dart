import 'package:flutter/material.dart';

import '../../models/liminal_app_spec.dart';
import 'widgets/html_app.dart';
import 'widgets/weather_app.dart';

typedef DesktopAppBuilder = Widget Function({
  required LiminalAppSpec spec,
  required AppCacheEntry? cache,
  required Color accent,
  int? sidecarPort,
  String? sidecarToken,
  int reloadToken,
  VoidCallback? onRefresh,
  VoidCallback? onHide,
});

bool isHtmlCapableAppType(String type) => type != 'weather';

/// Maps liminal app `type` strings to native Flutter widgets.
abstract final class AppRegistry {
  static DesktopAppBuilder? builderFor(String type) {
    switch (type) {
      case 'weather':
        return ({
          required spec,
          required cache,
          required accent,
          sidecarPort,
          sidecarToken,
          reloadToken = 0,
          onRefresh,
          onHide,
        }) =>
            WeatherApp(
              spec: spec,
              cache: cache,
              accent: accent,
              onRefresh: onRefresh,
              onHide: onHide,
            );
      case 'html':
      case 'markdown':
      case 'chart':
      case 'table':
      case 'iframe':
        return ({
          required spec,
          required cache,
          required accent,
          sidecarPort,
          sidecarToken,
          reloadToken = 0,
          onRefresh,
          onHide,
        }) =>
            HtmlApp(
              spec: spec,
              cache: cache,
              accent: accent,
              sidecarPort: sidecarPort,
              sidecarToken: sidecarToken,
              reloadToken: reloadToken,
              onRefresh: onRefresh,
              onHide: onHide,
            );
      default:
        return null;
    }
  }

  static Widget buildOrFallback({
    required LiminalAppSpec spec,
    required AppCacheEntry? cache,
    required Color accent,
    int? sidecarPort,
    String? sidecarToken,
    int reloadToken = 0,
    VoidCallback? onRefresh,
    VoidCallback? onHide,
  }) {
    final builder = builderFor(spec.type);
    if (builder != null) {
      return builder(
        spec: spec,
        cache: cache,
        accent: accent,
        sidecarPort: sidecarPort,
        sidecarToken: sidecarToken,
        reloadToken: reloadToken,
        onRefresh: onRefresh,
        onHide: onHide,
      );
    }
    return Scaffold(
      appBar: AppBar(title: Text(spec.title)),
      body: Center(
        child: Text('Unsupported app type: ${spec.type}'),
      ),
    );
  }
}
