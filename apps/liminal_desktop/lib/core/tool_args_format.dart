import 'dart:convert';

/// One-line hint for tool args (web `parsePrimaryArg` parity).
String formatToolPrimaryArg(String argsJson) {
  if (argsJson.trim().isEmpty) return '';
  try {
    final a = jsonDecode(argsJson);
    if (a is! Map) return '';
    final map = Map<String, dynamic>.from(a);
    if (map.isEmpty) return '';
    const keys = [
      'command',
      'path',
      'file_path',
      'query',
      'url',
      'key',
      'goal',
      'topic',
      'pid',
      'task_id',
      'ticker',
      'symbol',
      'name',
    ];
    for (final k in keys) {
      final v = map[k];
      if (v is String && v.isNotEmpty) {
        return _argLine(k, v);
      }
      if (v is num) return '$k: $v';
    }
    for (final e in map.entries) {
      final v = e.value;
      if (v is String && v.isNotEmpty && v.length < 120) {
        return _argLine(e.key, v);
      }
    }
  } catch (_) {
    // Incomplete JSON while streaming — skip.
  }
  return '';
}

bool isTrivialToolArgs(String argsJson) {
  final t = argsJson.trim();
  if (t.isEmpty) return true;
  if (t == '{}') return true;
  try {
    final parsed = jsonDecode(t);
    if (parsed is Map && parsed.isEmpty) return true;
  } catch (_) {}
  return false;
}

String _argLine(String key, String value) {
  final flat = value.replaceAll('\n', '↩');
  final clipped = flat.length > 70 ? '${flat.substring(0, 69)}…' : flat;
  return '$key: $clipped';
}
