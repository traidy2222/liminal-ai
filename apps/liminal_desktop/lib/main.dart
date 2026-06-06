import 'dart:io';

import 'package:flutter/material.dart';
import 'package:just_audio_media_kit/just_audio_media_kit.dart';
import 'package:path/path.dart' as p;

import 'app/liminal_app.dart';
import 'sidecar/launcher.dart';
import 'state/app_controller.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // just_audio needs a native backend on Windows/Linux or playback is silent.
  JustAudioMediaKit.ensureInitialized();
  final repoRoot = detectRepoRoot();
  final controller = AppController(repoRoot: repoRoot);
  runApp(LiminalApp(controller: controller));
}

/// Monorepo root for dev (`flutter run`) and fallback when bundle.json is absent.
String? detectRepoRoot() {
  final fromEnv = Platform.environment['LIMINAL_REPO_ROOT']?.trim();
  if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;

  final exeDir = executableDirectory();
  if (exeDir != null) {
    final bundled = readBundledLocations(exeDir);
    if (bundled != null) return bundled.repoRoot;
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
