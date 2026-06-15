import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

class UpdatePrefs {
  const UpdatePrefs({
    this.autoCheckOnLaunch = true,
    this.channel = 'stable',
    this.lastCheckAt,
    this.dismissedVersion,
  });

  final bool autoCheckOnLaunch;
  final String channel;
  final DateTime? lastCheckAt;
  final String? dismissedVersion;

  static UpdatePrefs fromJson(Map<String, dynamic> json) {
    return UpdatePrefs(
      autoCheckOnLaunch: json['autoCheckOnLaunch'] as bool? ?? true,
      channel: json['channel'] as String? ?? 'stable',
      lastCheckAt: json['lastCheckAt'] != null
          ? DateTime.tryParse(json['lastCheckAt'] as String)
          : null,
      dismissedVersion: json['dismissedVersion'] as String?,
    );
  }

  Map<String, dynamic> toJson() => {
        'autoCheckOnLaunch': autoCheckOnLaunch,
        'channel': channel,
        if (lastCheckAt != null) 'lastCheckAt': lastCheckAt!.toIso8601String(),
        if (dismissedVersion != null) 'dismissedVersion': dismissedVersion,
      };

  UpdatePrefs copyWith({
    bool? autoCheckOnLaunch,
    String? channel,
    DateTime? lastCheckAt,
    String? dismissedVersion,
  }) {
    return UpdatePrefs(
      autoCheckOnLaunch: autoCheckOnLaunch ?? this.autoCheckOnLaunch,
      channel: channel ?? this.channel,
      lastCheckAt: lastCheckAt ?? this.lastCheckAt,
      dismissedVersion: dismissedVersion ?? this.dismissedVersion,
    );
  }
}

class UpdatePrefsService {
  static String get _prefsPath {
    final home = Platform.environment['USERPROFILE'] ??
        Platform.environment['HOME'] ??
        Directory.current.path;
    return p.join(home, '.liminal', 'update_prefs.json');
  }

  static Future<UpdatePrefs> load() async {
    final file = File(_prefsPath);
    if (!await file.exists()) return const UpdatePrefs();
    try {
      final json = jsonDecode(await file.readAsString()) as Map<String, dynamic>;
      return UpdatePrefs.fromJson(json);
    } catch (_) {
      return const UpdatePrefs();
    }
  }

  static Future<void> save(UpdatePrefs prefs) async {
    final file = File(_prefsPath);
    await file.parent.create(recursive: true);
    await file.writeAsString(
      const JsonEncoder.withIndent('  ').convert(prefs.toJson()),
    );
  }
}
