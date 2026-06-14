import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:just_audio_media_kit/just_audio_media_kit.dart';
import 'package:path/path.dart' as p;
import 'package:webview_win_floating/webview_win_floating.dart';

import 'app/liminal_app.dart';
import 'apps/app_window_manager.dart';
import 'apps/app_window_root.dart';
import 'core/crash_reporter.dart';
import 'sidecar/launcher.dart';
import 'state/app_controller.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();
  _installCrashLogging();
  JustAudioMediaKit.ensureInitialized();

  final launchArgs = await AppWindowManager.currentSubWindowLaunchArgs();
  if (launchArgs != null && launchArgs.appId.isNotEmpty) {
    runApp(
      AppWindowRoot(
        appId: launchArgs.appId,
        launchArgs: launchArgs,
      ),
    );
    return;
  }

  final repoRoot = detectRepoRoot();
  final controller = AppController(repoRoot: repoRoot);
  runApp(LiminalApp(controller: controller));
}

void _installCrashLogging() async {
  final dsn = await _getSentryDsn();

  final userOptIn = await _getUserOptInPreference();

  final crashReporter = CrashReporter.instance;

  if (dsn.isNotEmpty) {
    try {
      await crashReporter.init(
        dsn: dsn,
        environment: kDebugMode ? 'development' : 'production',
        release: '0.1.0',
        userOptIn: userOptIn,
      );
    } catch (_) {
      // Fall through to file logging
    }
  }

  final previous = FlutterError.onError;
  FlutterError.onError = (details) {
    _appendDesktopLog(
      'FlutterError: ${details.exceptionAsString()}\n${details.stack}',
    );
    crashReporter.captureException(
      details.exception,
      details.stack,
      context: 'flutter_error',
    );
    previous?.call(details);
  };
  PlatformDispatcher.instance.onError = (error, stack) {
    _appendDesktopLog('Uncaught: $error\n$stack');
    crashReporter.captureException(error, stack, context: 'platform_error');
    return false;
  };
}

Future<String> _getSentryDsn() async {
  final home = Platform.environment['USERPROFILE'] ??
      Platform.environment['HOME'] ??
      Directory.current.path;
  final envPath = p.join(home, '.liminal', 'sentry.dsn');
  return CrashReporter.readDsnFromFile(envPath);

  // Or use environment variable:
  // return Platform.environment['SENTRY_DSN'] ?? '';
}

Future<bool> _getUserOptInPreference() async {
  final home = Platform.environment['USERPROFILE'] ??
      Platform.environment['HOME'] ??
      Directory.current.path;
  final prefsFile = File(p.join(home, '.liminal', 'crash_reporter_prefs.json'));
  if (!prefsFile.existsSync()) return false;
  try {
    final content = prefsFile.readAsStringSync();
    // Simple JSON parsing for opt-in flag
    return content.contains('"optIn":true') || content.contains('"optIn": true');
  } catch (_) {
    return false;
  }
}

void _appendDesktopLog(String line) {
  try {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    final file = File(p.join(home, '.liminal', 'desktop.log'));
    file.parent.createSync(recursive: true);
    final stamp = DateTime.now().toIso8601String();
    file.writeAsStringSync('[$stamp] $line\n', mode: FileMode.append);
  } catch (_) {
    /* logging must never throw */
  }
}

/// Monorepo root for dev (`flutter run`) and fallback when bundle.json is absent.
String? detectRepoRoot() {
  final fromEnv = Platform.environment['LIMINAL_REPO_ROOT']?.trim();
  if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;

  final exeDir = executableDirectory();
  if (exeDir != null) {
    final bundled = readBundledLocations(exeDir);
    if (bundled != null) return bundled.repoRoot;
    // Ignore stale bundle.json when liminald/repo is incomplete (e.g. failed rebundle).
  }

  final roots = <String>[
    if (executableDirectory() case final String exeDir) exeDir,
    Directory.current.path,
  ];

  for (final start in roots) {
    var dir = Directory(start);
    for (var i = 0; i < 12; i++) {
      final marker = File(p.join(dir.path, 'packages', 'sidecar', 'package.json'));
      if (marker.existsSync()) return dir.path;
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
  }
  return null;
}
