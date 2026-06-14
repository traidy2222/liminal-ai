import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

class CrashReporterPrefs {
  final bool optIn;
  final bool sendStackTraces;
  final bool sendUsageData;
  final DateTime? optedInAt;

  CrashReporterPrefs({
    this.optIn = false,
    this.sendStackTraces = true,
    this.sendUsageData = false,
    this.optedInAt,
  });

  static CrashReporterPrefs fromJson(Map<String, dynamic> json) {
    return CrashReporterPrefs(
      optIn: json['optIn'] as bool? ?? false,
      sendStackTraces: json['sendStackTraces'] as bool? ?? true,
      sendUsageData: json['sendUsageData'] as bool? ?? false,
      optedInAt: json['optedInAt'] != null
          ? DateTime.tryParse(json['optedInAt'] as String)
          : null,
    );
  }

  Map<String, dynamic> toJson() => {
        'optIn': optIn,
        'sendStackTraces': sendStackTraces,
        'sendUsageData': sendUsageData,
        if (optedInAt != null) 'optedInAt': optedInAt!.toIso8601String(),
      };

  CrashReporterPrefs copyWith({
    bool? optIn,
    bool? sendStackTraces,
    bool? sendUsageData,
    DateTime? optedInAt,
  }) {
    return CrashReporterPrefs(
      optIn: optIn ?? this.optIn,
      sendStackTraces: sendStackTraces ?? this.sendStackTraces,
      sendUsageData: sendUsageData ?? this.sendUsageData,
      optedInAt: optedInAt ?? this.optedInAt,
    );
  }
}

class CrashReporterPrefsService {
  static String get _prefsPath {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    return p.join(home, '.liminal', 'crash_reporter_prefs.json');
  }

  static Future<CrashReporterPrefs> load() async {
    final file = File(_prefsPath);
    if (!await file.exists()) {
      return CrashReporterPrefs();
    }
    try {
      final content = await file.readAsString();
      final json = jsonDecode(content) as Map<String, dynamic>;
      return CrashReporterPrefs.fromJson(json);
    } catch (_) {
      return CrashReporterPrefs();
    }
  }

  static Future<void> save(CrashReporterPrefs prefs) async {
    final file = File(_prefsPath);
    await file.parent.create(recursive: true);
    final json = prefs.toJson();
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(json),
    );
  }
}
