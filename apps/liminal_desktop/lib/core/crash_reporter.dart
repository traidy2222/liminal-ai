import 'dart:io';

import 'package:sentry_flutter/sentry_flutter.dart';

class CrashReporter {
  static CrashReporter? _instance;
  static CrashReporter get instance => _instance ??= CrashReporter._();

  CrashReporter._();

  bool _initialized = false;
  bool _userOptIn = false;

  Future<void> init({
    required String dsn,
    String environment = 'production',
    String release = '0.1.0',
    bool userOptIn = false,
  }) async {
    if (_initialized) return;

    _userOptIn = userOptIn;

    await SentryFlutter.init(
      (options) {
        options.dsn = dsn;
        options.environment = environment;
        options.release = release;
        options.tracesSampleRate = 0.2;
        options.profilesSampleRate = 0.1;
        options.attachStacktrace = true;
        options.reportSilentFlutterErrors = true;
        options.enableUserInteractionBreadcrumbs = false;
        options.sendDefaultPii = false;
      },
    );

    _initialized = true;
    _captureNativeCrashes();
  }

  void _captureNativeCrashes() {
    if (_userOptIn) {
      Sentry.captureMessage('Crash reporter initialized');
    }
  }

  Future<void> setUserContext({
    String? userId,
    String? email,
    String? username,
  }) async {
    if (!_initialized || !_userOptIn) return;

    final user = SentryUser(
      id: userId ?? _generateAnonymousId(),
      email: email,
      username: username,
    );

    Sentry.configureScope((scope) {
      scope.setUser(user);
    });
  }

  Future<void> clearUserContext() async {
    Sentry.configureScope((scope) {
      scope.setUser(null);
    });
  }

  void addBreadcrumb({
    required String message,
    String? category,
    String? level,
  }) {
    Sentry.addBreadcrumb(
      Breadcrumb(
        message: message,
        category: category ?? 'app',
        level: _parseLevel(level),
      ),
    );
  }

  SentryLevel _parseLevel(String? level) {
    return switch (level) {
      'debug' => SentryLevel.debug,
      'info' => SentryLevel.info,
      'warning' => SentryLevel.warning,
      'error' => SentryLevel.error,
      'fatal' => SentryLevel.fatal,
      _ => SentryLevel.info,
    };
  }

  Future<void> captureException(
    dynamic exception,
    StackTrace? stackTrace, {
    String? context,
  }) async {
    if (!_initialized) return;

    await Sentry.captureException(
      exception,
      stackTrace: stackTrace,
      withScope: (scope) {
        if (context != null) {
          scope.setTag('context', context);
        }
      },
    );
  }

  Future<void> captureMessage(String message, {String? level}) async {
    if (!_initialized) return;

    await Sentry.captureMessage(
      message,
      level: _parseLevel(level),
    );
  }

  String _generateAnonymousId() {
    return 'anon-${DateTime.now().millisecondsSinceEpoch}';
  }

  static bool get isOptedIn => instance._userOptIn;

  static Future<String> readDsnFromFile(String path) async {
    final file = File(path);
    if (!await file.exists()) {
      return '';
    }
    final content = await file.readAsString();
    return content.trim();
  }
}
