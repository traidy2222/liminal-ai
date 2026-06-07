import 'dart:async';
import 'dart:convert';

import 'package:desktop_multi_window/desktop_multi_window.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:window_manager/window_manager.dart';

import '../models/liminal_app_spec.dart';
import 'app_method_channel.dart';
import 'app_registry.dart';
import 'app_window_args.dart';
import 'widget_window_chrome.dart';

/// Material shell for a secondary OS window (one liminal app instance).
class AppWindowRoot extends StatefulWidget {
  const AppWindowRoot({
    super.key,
    required this.appId,
    this.launchArgs,
  });

  final String appId;
  final AppWindowLaunchArgs? launchArgs;

  @override
  State<AppWindowRoot> createState() => _AppWindowRootState();
}

class _AppWindowRootState extends State<AppWindowRoot> {
  LiminalAppSpec? _spec;
  AppCacheEntry? _cache;
  Color _accent = const Color(0xFF6EE7B7);
  int? _sidecarPort;
  String? _sidecarToken;
  int _reloadToken = 0;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    unawaited(_init());
  }

  Future<void> _init() async {
    await windowManager.ensureInitialized();
    final launch = widget.launchArgs;
    if (launch != null && launch.hasEmbeddedChrome) {
      await applyChromeFromLaunchArgs(launch);
    }
    await _bindPushHandler();
    await _loadInitialState();
  }

  Future<void> _bindPushHandler() async {
    final controller = await WindowController.fromCurrentEngine();
    await controller.setWindowMethodHandler((call) async {
      switch (call.method) {
        case 'push_data':
          final raw = call.arguments;
          if (raw is String && raw.isNotEmpty) {
            final decoded = jsonDecode(raw);
            if (decoded is Map && mounted) {
              final cacheJson = decoded['cache'];
              if (cacheJson is Map) {
                setState(() {
                  _cache = AppCacheEntry.fromJson(Map<String, dynamic>.from(cacheJson));
                });
              }
            }
          }
          return 'ok';
        case 'push_spec':
          final raw = call.arguments;
          if (raw is String && raw.isNotEmpty) {
            final decoded = jsonDecode(raw);
            if (decoded is Map && mounted) {
              final next = LiminalAppSpec.fromJson(Map<String, dynamic>.from(decoded));
              setState(() => _spec = next);
              await applyChromeFromSpec(next);
            }
          }
          return 'ok';
        case 'push_html':
          if (mounted) {
            setState(() => _reloadToken++);
          }
          return 'ok';
        case 'liminal_close':
          await controller.hide();
          return 'ok';
        default:
          throw MissingPluginException('Not implemented: ${call.method}');
      }
    });
  }

  Future<void> _loadInitialState() async {
    Object? lastError;
    for (var attempt = 0; attempt < 5; attempt++) {
      if (attempt > 0) {
        await Future<void>.delayed(Duration(milliseconds: 120 * attempt));
      }
      try {
        final raw = await liminalAppsMethodChannel.invokeMethod(
          'get_state',
          widget.appId,
        );
        if (!mounted) return;
        if (raw is String) {
          await _applyStatePayload(raw);
          return;
        }
        lastError = 'Unexpected state from main window.';
      } catch (e) {
        lastError = e;
      }
    }
    if (mounted) {
      setState(() {
        _loading = false;
        _error = lastError?.toString() ?? 'Could not reach main window.';
      });
    }
  }

  Future<void> _applyStatePayload(String raw) async {
    if (raw.isEmpty) {
      setState(() {
        _loading = false;
        _error = 'App not found in main window.';
      });
      return;
    }
    final decoded = jsonDecode(raw);
    if (decoded is! Map) {
      setState(() {
        _loading = false;
        _error = 'Invalid app state payload.';
      });
      return;
    }
    final map = Map<String, dynamic>.from(decoded);
    final appJson = map['app'];
    final cacheJson = map['cache'];
    final accentHex = map['accent'] as String?;
    final portRaw = map['sidecarPort'];
    final tokenRaw = map['sidecarToken'];
    LiminalAppSpec? nextSpec;
    if (appJson is Map) {
      nextSpec = LiminalAppSpec.fromJson(Map<String, dynamic>.from(appJson));
    }
    if (nextSpec != null) {
      await applyChromeFromSpec(nextSpec);
    }
    if (!mounted) return;
    setState(() {
      _spec = nextSpec;
      if (cacheJson is Map) {
        _cache = AppCacheEntry.fromJson(Map<String, dynamic>.from(cacheJson));
      }
      if (accentHex != null && accentHex.startsWith('#')) {
        _accent = _parseHexColor(accentHex);
      }
      if (portRaw is num) _sidecarPort = portRaw.toInt();
      if (tokenRaw is String && tokenRaw.isNotEmpty) _sidecarToken = tokenRaw;
      _loading = false;
      _error = _spec == null ? 'App not found.' : null;
    });
    if (nextSpec != null && _cache == null) {
      unawaited(_requestRefresh());
    }
  }

  Color _parseHexColor(String hex) {
    var h = hex.substring(1);
    if (h.length == 6) h = 'FF$h';
    final value = int.tryParse(h, radix: 16);
    if (value == null) return _accent;
    return Color(value);
  }

  Future<void> _requestRefresh() async {
    try {
      await liminalAppsMethodChannel.invokeMethod('refresh', widget.appId);
    } catch (_) {
      // Main window handles refresh and pushes cache updates.
    }
  }

  Future<void> _hideWidget() async {
    try {
      final controller = await WindowController.fromCurrentEngine();
      await controller.hide();
    } catch (_) {
      await hideCurrentAppWindow();
    }
  }

  bool get _frameless =>
      _spec?.isWidgetMode == true || widget.launchArgs?.effectiveShell.isWidget == true;

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return _themedMaterial(
        accent: _accent,
        transparent: _frameless,
        home: Center(child: CircularProgressIndicator(color: _accent)),
      );
    }

    if (_error != null || _spec == null) {
      return _themedMaterial(
        accent: _accent,
        transparent: _frameless,
        home: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Text(_error ?? 'Unknown error', textAlign: TextAlign.center),
          ),
        ),
      );
    }

    return _themedMaterial(
      accent: _accent,
      transparent: _spec!.isWidgetMode,
      home: AppRegistry.buildOrFallback(
        spec: _spec!,
        cache: _cache,
        accent: _accent,
        sidecarPort: _sidecarPort,
        sidecarToken: _sidecarToken,
        reloadToken: _reloadToken,
        onRefresh: _requestRefresh,
        onHide: _hideWidget,
      ),
    );
  }

  Widget _themedMaterial({
    required Color accent,
    required Widget home,
    bool transparent = false,
  }) {
    return MaterialApp(
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: accent, brightness: Brightness.dark),
        useMaterial3: true,
        scaffoldBackgroundColor:
            transparent ? Colors.transparent : const Color(0xFF0A0E14),
      ),
      home: home,
    );
  }
}
