import 'dart:async';
import 'dart:convert';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/services.dart';

import '../models/liminal_app_spec.dart';
import 'app_window_args.dart';
import 'app_method_channel.dart';

typedef AppRefreshCallback = Future<void> Function(String appId);

/// Opens and tracks separate OS windows for liminal desktop apps.
class AppWindowManager {
  AppWindowManager({
    required String Function() resolveAccentHex,
    int? Function()? resolveSidecarPort,
    String? Function()? resolveSidecarToken,
    this.onRefresh,
  })  : _resolveAccentHex = resolveAccentHex,
        _resolveSidecarPort = resolveSidecarPort,
        _resolveSidecarToken = resolveSidecarToken;

  final String Function() _resolveAccentHex;
  final int? Function()? _resolveSidecarPort;
  final String? Function()? _resolveSidecarToken;
  final AppRefreshCallback? onRefresh;

  final Map<String, WindowController> _controllers = {};
  List<LiminalAppSpec> _apps = const [];
  final Map<String, AppCacheEntry> _caches = {};
  bool _bootRestored = false;

  static Future<AppWindowLaunchArgs?> currentSubWindowLaunchArgs() async {
    final controller = await WindowController.fromCurrentEngine();
    final args = controller.arguments.trim();
    if (args.isEmpty || args == 'main') return null;
    return AppWindowLaunchArgs.parse(args);
  }

  @Deprecated('Use currentSubWindowLaunchArgs')
  static Future<String?> currentSubWindowAppId() async {
    final launch = await currentSubWindowLaunchArgs();
    return launch?.appId;
  }

  void bindMainWindowHandler() {
    _channelReady = _registerMainWindowHandler();
  }

  Future<void> ensureChannelReady() => _channelReady ?? Future.value();

  Future<void>? _channelReady;

  Future<void> _registerMainWindowHandler() async {
    await liminalAppsMethodChannel.setMethodCallHandler((call) async {
      switch (call.method) {
        case 'get_state':
          final appId = call.arguments as String? ?? '';
          return _encodeState(appId);
        case 'refresh':
          final appId = call.arguments as String? ?? '';
          if (onRefresh != null) {
            await onRefresh!(appId);
          }
          return 'ok';
        default:
          throw MissingPluginException('Unknown method: ${call.method}');
      }
    });
  }

  String _encodeState(String appId) {
    final spec = _apps.cast<LiminalAppSpec?>().firstWhere(
          (a) => a?.id == appId,
          orElse: () => null,
        );
    if (spec == null) return '';
    return jsonEncode({
      'app': spec.toJson(),
      'cache': _caches[appId]?.toJson(),
      'accent': _resolveAccentHex(),
      'sidecarPort': _resolveSidecarPort?.call(),
      'sidecarToken': _resolveSidecarToken?.call(),
    });
  }

  void syncRegistry({
    required List<LiminalAppSpec> apps,
    required Map<String, AppCacheEntry> caches,
    bool openAutoOnBoot = false,
  }) {
    _apps = apps;
    _caches
      ..clear()
      ..addAll(caches);

    if (openAutoOnBoot && !_bootRestored) {
      _bootRestored = true;
      for (final app in apps) {
        if (app.autoOpen) {
          unawaited(openWindow(app));
        }
      }
    }
  }

  void updateCache(String appId, AppCacheEntry cache) {
    _caches[appId] = cache;
    final controller = _controllers[appId];
    if (controller != null) {
      unawaited(
        controller.invokeMethod(
          'push_data',
          jsonEncode({'cache': cache.toJson()}),
        ),
      );
    }
  }

  void updateSpec(LiminalAppSpec spec) {
    final next = List<LiminalAppSpec>.from(_apps);
    final idx = next.indexWhere((a) => a.id == spec.id);
    if (idx >= 0) {
      next[idx] = spec;
    } else {
      next.add(spec);
    }
    _apps = next;

    final controller = _controllers[spec.id];
    if (controller != null) {
      unawaited(controller.invokeMethod('push_spec', jsonEncode(spec.toJson())));
      if (spec.type != 'weather') {
        unawaited(controller.invokeMethod('push_html', ''));
      }
    }
  }

  void removeApp(String appId) {
    _apps = _apps.where((a) => a.id != appId).toList();
    _caches.remove(appId);
  }

  bool isOpen(String appId) => _controllers.containsKey(appId);

  Future<void> openWindow(LiminalAppSpec spec) async {
    await ensureChannelReady();
    if (_controllers.containsKey(spec.id)) {
      final controller = _controllers[spec.id]!;
      await controller.invokeMethod('push_spec', jsonEncode(spec.toJson()));
      if (spec.type != 'weather') {
        await controller.invokeMethod('push_html', '');
      }
      await controller.show();
      return;
    }

    final controller = await WindowController.create(
      WindowConfiguration(
        hiddenAtLaunch: true,
        arguments: AppWindowLaunchArgs.fromSpec(spec).encode(),
      ),
    );

    _controllers[spec.id] = controller;
    await controller.show();
  }

  Future<void> closeWindow(String appId) async {
    final controller = _controllers.remove(appId);
    if (controller != null) {
      // desktop_multi_window 0.3 exposes show/hide on the platform channel;
      // sub-windows can also handle `liminal_close` (see AppWindowRoot).
      try {
        await controller.invokeMethod('liminal_close');
      } catch (_) {
        await controller.hide();
      }
    }
  }

  Future<void> closeAll() async {
    final ids = _controllers.keys.toList();
    for (final id in ids) {
      await closeWindow(id);
    }
  }
}
