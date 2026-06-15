import 'dart:convert';
import 'dart:io';

import 'package:package_info_plus/package_info_plus.dart';
import 'package:path/path.dart' as p;

import '../../sidecar/launcher.dart';
import 'semver.dart';

class LocalVersions {
  const LocalVersions({
    required this.appVersion,
    this.harnessVersion,
    required this.isPortableInstall,
    required this.isDevBuild,
    this.exeDir,
  });

  final String appVersion;
  final String? harnessVersion;
  final bool isPortableInstall;
  final bool isDevBuild;
  final String? exeDir;

  static Future<LocalVersions> load({String? repoRoot}) async {
    final info = await PackageInfo.fromPlatform();
    final exeDir = executableDirectory();
    String? harnessVersion;
    var isPortable = false;

    if (exeDir != null) {
      final manifest = File(p.join(exeDir, 'liminald', 'bundle.json'));
      if (manifest.existsSync()) {
        isPortable = true;
        try {
          final json = jsonDecode(manifest.readAsStringSync()) as Map<String, dynamic>;
          final raw = json['liminalVersion'] as String?;
          if (raw != null && raw.trim().isNotEmpty) {
            harnessVersion = normalizeVersion(raw);
          }
        } catch (_) {}
      }
    }

    final isDevBuild = repoRoot != null && repoRoot.isNotEmpty;

    return LocalVersions(
      appVersion: normalizeVersion(info.version),
      harnessVersion: harnessVersion,
      isPortableInstall: isPortable,
      isDevBuild: isDevBuild,
      exeDir: exeDir,
    );
  }
}
