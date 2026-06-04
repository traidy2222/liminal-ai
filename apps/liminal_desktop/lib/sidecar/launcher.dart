import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

import 'handshake.dart';

/// Resolved paths to spawn `liminald`.
class SidecarLocations {
  SidecarLocations({required this.scriptPath, required this.repoRoot});

  final String scriptPath;
  final String repoRoot;
}

/// Result of spawning `liminald`.
class SidecarProcess {
  SidecarProcess({
    required this.port,
    required this.token,
    required this.pid,
    this.process,
  });

  /// Non-null when this UI spawned the sidecar (kill on quit).
  final Process? process;
  final int port;
  final String token;
  final int pid;

  bool get owned => process != null;

  Future<void> kill() async {
    final proc = process;
    if (proc == null) return;
    if (await proc.exitCode.timeout(Duration.zero, onTimeout: () => -1) == -1) {
      proc.kill(ProcessSignal.sigterm);
    }
  }
}

/// Directory containing the running `.exe` (or script in `flutter run`).
String? executableDirectory() {
  try {
    final exe = Platform.resolvedExecutable;
    if (exe.isEmpty) return null;
    return p.normalize(p.dirname(exe));
  } catch (_) {
    return null;
  }
}

/// Read `liminald/bundle.json` written by `scripts/bundle-liminald-for-desktop.ps1`.
SidecarLocations? readBundledLocations(String exeDir) {
  final manifest = File(p.join(exeDir, 'liminald', 'bundle.json'));
  if (!manifest.existsSync()) return null;
  try {
    final json = jsonDecode(manifest.readAsStringSync()) as Map<String, dynamic>;
    final script = json['sidecarScript'] as String?;
    final root = json['repoRoot'] as String?;
    if (script == null || root == null) return null;
    if (!File(script).existsSync()) return null;
    return SidecarLocations(scriptPath: p.normalize(script), repoRoot: p.normalize(root));
  } catch (_) {
    return null;
  }
}

SidecarLocations? _locationsFromRepoRoot(String root) {
  final script = p.join(root, 'packages', 'sidecar', 'dist', 'index.js');
  if (!File(script).existsSync()) return null;
  return SidecarLocations(scriptPath: p.normalize(script), repoRoot: p.normalize(root));
}

/// Resolve the compiled sidecar entry and its repo/bundle root.
SidecarLocations? resolveSidecarLocations({String? repoRoot}) {
  final fromEnvScript = Platform.environment['LIMINALD_SCRIPT']?.trim();
  if (fromEnvScript != null && fromEnvScript.isNotEmpty && File(fromEnvScript).existsSync()) {
    final root = Platform.environment['LIMINAL_REPO_ROOT']?.trim() ??
        p.normalize(p.join(p.dirname(fromEnvScript), '..', '..', '..'));
    return SidecarLocations(scriptPath: fromEnvScript, repoRoot: root);
  }

  final exeDir = executableDirectory();
  if (exeDir != null) {
    final bundled = readBundledLocations(exeDir);
    if (bundled != null) return bundled;

    final nextToExe = _locationsFromRepoRoot(p.join(exeDir, 'liminald', 'repo'));
    if (nextToExe != null) return nextToExe;

    var dir = Directory(exeDir);
    for (var i = 0; i < 12; i++) {
      final hit = _locationsFromRepoRoot(dir.path);
      if (hit != null) return hit;
      final parent = dir.parent;
      if (parent.path == dir.path) break;
      dir = parent;
    }
  }

  final roots = <String>{
    if (repoRoot != null && repoRoot.isNotEmpty) repoRoot,
    if (Platform.environment['LIMINAL_REPO_ROOT'] != null)
      Platform.environment['LIMINAL_REPO_ROOT']!,
    Directory.current.path,
  };
  for (final root in roots) {
    final hit = _locationsFromRepoRoot(root);
    if (hit != null) return hit;
  }
  return null;
}

/// Locate `node` / `node.exe` on PATH.
String resolveNodeExecutable() {
  final fromEnv = Platform.environment['NODE']?.trim();
  if (fromEnv != null && fromEnv.isNotEmpty) {
    if (File(fromEnv).existsSync()) return fromEnv;
    if (fromEnv == 'node') {
      /* fall through to PATH search */
    } else {
      return fromEnv;
    }
  }
  final pathEnv = Platform.environment['PATH'] ?? '';
  final sep = Platform.isWindows ? ';' : ':';
  for (final dir in pathEnv.split(sep)) {
    final trimmed = dir.trim();
    if (trimmed.isEmpty) continue;
    final candidate = p.join(trimmed, Platform.isWindows ? 'node.exe' : 'node');
    if (File(candidate).existsSync()) return candidate;
  }
  return Platform.isWindows ? 'node.exe' : 'node';
}

/// Parse `LIMINALD_READY {"port":...}` from sidecar stdout.
SidecarReadyLine? parseReadyLine(String line) {
  const prefix = 'LIMINALD_READY ';
  if (!line.startsWith(prefix)) return null;
  try {
    final json = jsonDecode(line.substring(prefix.length)) as Map<String, dynamic>;
    return SidecarReadyLine(
      port: (json['port'] as num).toInt(),
      protocolVersion: (json['protocolVersion'] as num?)?.toInt() ?? 1,
    );
  } catch (_) {
    return null;
  }
}

class SidecarReadyLine {
  SidecarReadyLine({required this.port, required this.protocolVersion});
  final int port;
  final int protocolVersion;
}

/// Spawn `node <sidecar/dist/index.js>` and wait until it is reachable.
Future<SidecarProcess> launchSidecar({
  String? repoRoot,
  bool attachToExisting = false,
}) async {
  if (attachToExisting) {
    final existing = readHandshakeSync();
    if (existing != null) {
      return SidecarProcess(
        port: existing.port,
        token: existing.token,
        pid: existing.pid,
      );
    }
  }

  final locations = resolveSidecarLocations(repoRoot: repoRoot);
  if (locations == null) {
    final exeDir = executableDirectory() ?? '(unknown)';
    throw StateError(
      'Could not find liminald.\n'
      '• Run from repo: npm run build:sidecar\n'
      '• Rebuild the desktop app: npm run desktop:build:windows\n'
      '• Or set LIMINALD_SCRIPT / LIMINAL_REPO_ROOT\n'
      'Exe directory: $exeDir',
    );
  }

  final node = resolveNodeExecutable();

  final stderrBuffer = StringBuffer();
  final completer = Completer<SidecarReadyLine>();
  final process = await Process.start(
    node,
    [locations.scriptPath],
    workingDirectory: locations.repoRoot,
    environment: {
      ...Platform.environment,
      'LIMINAL_REPO_ROOT': locations.repoRoot,
    },
  );

  final stdoutSub = process.stdout
      .transform(utf8.decoder)
      .transform(const LineSplitter())
      .listen((line) {
    final ready = parseReadyLine(line.trim());
    if (ready != null && !completer.isCompleted) {
      completer.complete(ready);
    }
  });

  process.stderr.transform(utf8.decoder).listen((chunk) {
    stderrBuffer.write(chunk);
  });

  SidecarReadyLine ready;
  try {
    ready = await completer.future.timeout(
      const Duration(seconds: 60),
      onTimeout: () => throw TimeoutException(
        'liminald did not emit LIMINALD_READY within 60s.\n${stderrBuffer.toString()}',
      ),
    );
  } catch (e) {
    process.kill();
    await stdoutSub.cancel();
    final detail = stderrBuffer.toString().trim();
    if (detail.isNotEmpty) {
      throw StateError('$e\nliminald stderr:\n$detail');
    }
    rethrow;
  }

  final handshake = await waitForHandshake();
  final token = handshake?.token;
  if (token == null || token.isEmpty) {
    process.kill();
    throw StateError('liminald started but handshake file missing token.');
  }

  return SidecarProcess(
    process: process,
    port: ready.port,
    token: token,
    pid: handshake?.pid ?? process.pid,
  );
}
