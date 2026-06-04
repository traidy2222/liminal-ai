import 'dart:io';

import '../sidecar/launcher.dart';

/// Spawns or attaches to `liminald` and exposes port/token for the protocol client.
class SidecarLifecycle {
  SidecarLifecycle({this.repoRoot});

  String? repoRoot;
  SidecarProcess? process;

  Future<SidecarProcess> ensureRunning({bool attachToExisting = false}) async {
    if (process != null) return process!;
    process = await launchSidecar(
      repoRoot: repoRoot,
      attachToExisting: attachToExisting,
    );
    return process!;
  }

  Future<void> shutdown() async {
    await process?.kill();
    process = null;
  }

  static bool get attachFromEnv => Platform.environment['LIMINALD_ATTACH'] == '1';
}
