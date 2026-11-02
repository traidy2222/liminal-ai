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

  static bool usesExternalRepoRoot(String? selected, String? bundled) {
    if (selected == null || selected.trim().isEmpty) return false;
    return bundled == null ||
        !p.equals(p.normalize(p.absolute(selected)),
            p.normalize(p.absolute(bundled)));
  }

  static Future<LocalVersions> load({String? repoRoot}) async {
    final info = await PackageInfo.fromPlatform();
    final exeDir = executableDirectory();
    String? harnessVersion;
    var isPortable = false;
    String? bundledRepoRoot;

    if (exeDir != null) {
      final manifest = File(p.join(exeDir, 'liminald', 'bundle.json'));
      if (manifest.existsSync()) {
        isPortable = true;
        try {
          final json =
              jsonDecode(manifest.readAsStringSync()) as Map<String, dynamic>;
          final repo = json['repoRoot'] as String?;
          bundledRepoRoot = repo == null
              ? p.join(exeDir, 'liminald', 'repo')
              : p.isAbsolute(repo)
                  ? p.normalize(repo)
                  : p.normalize(p.join(exeDir, repo));
          final raw = json['liminalVersion'] as String?;
          if (raw != null && raw.trim().isNotEmpty) {
            harnessVersion = normalizeVersion(raw);
          }
        } catch (_) {}
      }
    }

    final isDevBuild = usesExternalRepoRoot(repoRoot, bundledRepoRoot);

    return LocalVersions(
      appVersion: normalizeVersion(info.version),
      harnessVersion: harnessVersion,
      isPortableInstall: isPortable,
      isDevBuild: isDevBuild,
      exeDir: exeDir,
    );
  }
}
