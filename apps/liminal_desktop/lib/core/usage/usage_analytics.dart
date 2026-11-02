import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path/path.dart' as p;

enum UsageMilestone { appOpen, appReady, conversationCompleted }

const _wireNames = {
  UsageMilestone.appOpen: 'app_open',
  UsageMilestone.appReady: 'app_ready',
  UsageMilestone.conversationCompleted: 'conversation_completed',
};

/// Optional product analytics. No startup/model request depends on its network
/// result. The production client sends only this file's fixed payload fields.
class UsageAnalytics extends ChangeNotifier {
  UsageAnalytics({
    File? preferencesFile,
    http.Client? client,
    Future<String> Function()? loadVersion,
    DateTime Function()? now,
    String? platform,
    bool enabledForBuild = const bool.fromEnvironment('LIMINAL_USAGE_ENABLED',
        defaultValue: kReleaseMode,),
  })  : _file = preferencesFile ?? _defaultFile(),
        _client = client ?? http.Client(),
        _loadVersion = loadVersion ??
            (() async => (await PackageInfo.fromPlatform()).version),
        _now = now ?? DateTime.now,
        _platform = platform ?? Platform.operatingSystem,
        available = enabledForBuild &&
            Platform.environment['LIMINAL_MARKETING_CAPTURE'] != '1';

  static final endpoint =
      Uri.parse('https://api.vireondynamics.com/v1/liminal/usage');
  final File _file;
  final http.Client _client;
  final Future<String> Function() _loadVersion;
  final DateTime Function() _now;
  final String _platform;
  final bool available;
  bool initialized = false;
  bool? choice;
  String? error;
  String? _token;
  String? _version;
  final Set<String> _sent = {};
  Future<void>? _initialization;
  Future<void> _chain = Future.value();
  DateTime? _retryAfter;
  bool _closed = false;
  int _consentRevision = 0;

  bool get sharing => available && choice == true;
  bool get hasSharedIdentity => _token != null;

  static File _defaultFile() {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    return File(p.join(home, '.liminal', 'usage_preferences.json'));
  }

  void _notify() {
    if (!_closed) notifyListeners();
  }

  Future<void> initialize() => _initialization ??= _initialize();

  Future<void> _initialize() async {
    try {
      if (!available) return;
      _version = await _loadVersion();
      if (await _file.exists()) {
        final data =
            jsonDecode(await _file.readAsString()) as Map<String, dynamic>;
        if (data['schema'] == 1) {
          choice = data['consent'] is bool ? data['consent'] as bool : null;
          final token = data['installation_id'];
          if (token is String && RegExp(r'^[a-f0-9]{64}$').hasMatch(token)) {
            _token = token;
          }
          final today = _day();
          if (data['sent'] is List) {
            _sent.addAll((data['sent'] as List).whereType<String>().where(
                (key) =>
                    _wireNames.values.any((name) => key == '$today:$name'),),);
          }
          // An incomplete opt-in must not create a new identity silently.
          if (choice == true && _token == null) choice = null;
        }
      }
    } catch (_) {
      choice = null;
      _token = null;
      _sent.clear();
      error = 'Usage preferences could not be loaded. Nothing is being shared.';
    } finally {
      initialized = true;
      _notify();
    }
    if (sharing) unawaited(record(UsageMilestone.appOpen));
  }

  String _day() => _now().toUtc().toIso8601String().substring(0, 10);

  Future<void> _save() async {
    await _file.parent.create(recursive: true);
    final temporary =
        File('${_file.path}.$pid.${DateTime.now().microsecondsSinceEpoch}.tmp');
    try {
      await temporary.writeAsString(
          jsonEncode({
            'schema': 1,
            'consent': choice,
            if (_token != null) 'installation_id': _token,
            'sent': _sent.toList(),
          }),
          flush: true,);
      await temporary.rename(_file.path);
    } finally {
      if (await temporary.exists()) await temporary.delete();
    }
  }

  Future<void> _serial(Future<void> Function() work) {
    final next = _chain.then((_) async {
      if (!_closed) await work();
    });
    _chain = next.catchError((Object _) {});
    return next;
  }

  Future<void> choose(bool consent) async {
    await initialize();
    if (!available || _closed) return;
    final revision = ++_consentRevision;
    choice =
        consent; // Stop queued sharing immediately when consent is withdrawn.
    error = null;
    _notify();
    await _serial(() async {
      if (revision != _consentRevision) return;
      if (consent && _token == null) {
        final random = Random.secure();
        _token = List.generate(32,
                (_) => random.nextInt(256).toRadixString(16).padLeft(2, '0'),)
            .join();
      }
      try {
        await _save();
      } catch (_) {
        choice = false;
        error =
            'Sharing is off for this session. Your preference could not be saved; check the app data folder permissions.';
      }
      _notify();
    });
    if (sharing && revision == _consentRevision) {
      unawaited(record(UsageMilestone.appOpen));
    }
  }

  Future<void> record(UsageMilestone milestone) async {
    await initialize();
    if (!sharing || _closed || _token == null || _version == null) return;
    final revision = _consentRevision;
    await _serial(() async {
      if (!sharing || revision != _consentRevision || _token == null) return;
      final now = _now();
      if (_retryAfter != null && now.isBefore(_retryAfter!)) return;
      final key = '${_day()}:${_wireNames[milestone]}';
      if (_sent.contains(key)) return;
      try {
        final response = await _client
            .post(endpoint,
                headers: {'Content-Type': 'application/json'},
                body: jsonEncode({
                  'schema': 1,
                  'installation_id': _token,
                  'event': _wireNames[milestone],
                  'platform': _platform,
                  'version': _version,
                }),)
            .timeout(const Duration(seconds: 4));
        if (response.statusCode != 204) {
          _retryAfter = now.add(const Duration(minutes: 5));
          return;
        }
        _sent.removeWhere((item) => !item.startsWith('${_day()}:'));
        _sent.add(key);
        await _save();
      } catch (_) {
        _retryAfter = now.add(const Duration(minutes: 5));
      }
    });
  }

  /// Turns off sharing first. A failed deletion keeps the token only so the user
  /// can retry; it does not re-enable analytics.
  Future<void> deleteSharedHistory() async {
    await initialize();
    if (!available || _closed) return;
    ++_consentRevision;
    choice = false;
    error = null;
    _notify();
    await _serial(() async {
      try {
        await _save();
        if (_token != null) {
          final response = await _client
              .delete(endpoint,
                  headers: {'Content-Type': 'application/json'},
                  body: jsonEncode({'schema': 1, 'installation_id': _token}),)
              .timeout(const Duration(seconds: 4));
          if (response.statusCode != 204) {
            throw const HttpException('Deletion unavailable');
          }
        }
        _token = null;
        _sent.clear();
        _retryAfter = null;
        await _save();
      } catch (_) {
        error =
            'Sharing is off. Could not confirm deletion; please try deleting again when online.';
      }
      _notify();
    });
  }

  @override
  void dispose() {
    _closed = true;
    _client.close();
    super.dispose();
  }
}
