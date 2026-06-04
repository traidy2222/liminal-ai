import 'dart:convert';
import 'dart:io';

import 'package:path/path.dart' as p;

/// Record written by `liminald` to `~/.liminal/sidecar.json`.
class HandshakeRecord {
  HandshakeRecord({
    required this.protocolVersion,
    required this.port,
    required this.token,
    required this.pid,
    required this.startedAt,
  });

  final int protocolVersion;
  final int port;
  final String token;
  final int pid;
  final int startedAt;

  factory HandshakeRecord.fromJson(Map<String, dynamic> json) {
    return HandshakeRecord(
      protocolVersion: (json['protocolVersion'] as num?)?.toInt() ?? 1,
      port: (json['port'] as num).toInt(),
      token: json['token'] as String,
      pid: (json['pid'] as num).toInt(),
      startedAt: (json['startedAt'] as num?)?.toInt() ?? 0,
    );
  }
}

String liminalHome() {
  final fromEnv = Platform.environment['LIMINAL_HOME']?.trim();
  if (fromEnv != null && fromEnv.isNotEmpty) return fromEnv;
  final home = Platform.environment['USERPROFILE'] ??
      Platform.environment['HOME'] ??
      '';
  return p.join(home, '.liminal');
}

String handshakeFilePath() => p.join(liminalHome(), 'sidecar.json');

/// Poll until the sidecar writes its handshake file or [timeout] elapses.
Future<HandshakeRecord?> waitForHandshake({
  Duration timeout = const Duration(seconds: 30),
  Duration pollInterval = const Duration(milliseconds: 100),
}) async {
  final file = File(handshakeFilePath());
  final deadline = DateTime.now().add(timeout);
  while (DateTime.now().isBefore(deadline)) {
    if (await file.exists()) {
      try {
        final text = await file.readAsString();
        final json = jsonDecode(text) as Map<String, dynamic>;
        return HandshakeRecord.fromJson(json);
      } catch (_) {
        /* file may be mid-write */
      }
    }
    await Future<void>.delayed(pollInterval);
  }
  return null;
}

HandshakeRecord? readHandshakeSync() {
  final file = File(handshakeFilePath());
  if (!file.existsSync()) return null;
  try {
    final json = jsonDecode(file.readAsStringSync()) as Map<String, dynamic>;
    return HandshakeRecord.fromJson(json);
  } catch (_) {
    return null;
  }
}
