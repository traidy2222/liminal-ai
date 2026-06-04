/// Parse harness `tool_result` wire payloads (nested `result` object).
({bool ok, String output}) parseWireToolResult(Map<String, dynamic> data) {
  final nested = data['result'];
  if (nested is Map) {
    final ok = nested['ok'] as bool? ?? false;
    if (ok) {
      return (ok: true, output: nested['output'] as String? ?? '');
    }
    return (ok: false, output: nested['error'] as String? ?? '');
  }
  return (
    ok: data['ok'] as bool? ?? false,
    output: data['output'] as String? ??
        data['error'] as String? ??
        '',
  );
}
