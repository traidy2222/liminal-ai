import 'dart:convert';
import 'dart:io';

/// Opt-in local timing only: no transcript, audio, provider keys or URLs.
final _diagnosticsRoot =
    '${Platform.environment['USERPROFILE'] ?? Platform.environment['HOME'] ?? Directory.systemTemp.path}/.liminal';
// A local marker survives Windows package activation, which does not forward
// the launching shell's environment/stdout to the final UI host.
final bool _testProcess = Platform.environment.containsKey('FLUTTER_TEST');
final bool _environmentTiming =
    !_testProcess && Platform.environment['LIMINAL_VOICE_TIMING'] == '1';
final int? _timingExpires = _diagnosticExpiry();
int? _diagnosticExpiry() {
  if (_testProcess) return null;
  try {
    final value = File(
      '$_diagnosticsRoot/voice-diagnostics.enabled',
    ).readAsStringSync().trim();
    return int.tryParse(value);
  } catch (_) {
    return null;
  }
}

bool get voiceTimingEnabled =>
    _environmentTiming ||
    (_timingExpires != null &&
        DateTime.now().millisecondsSinceEpoch < _timingExpires!);
Future<void> _writes = Future.value();
int _entries = 0;
void voiceTiming(String stage, [Map<String, Object?> extra = const {}]) {
  if (voiceTimingEnabled) {
    final entry = jsonEncode({
      'stage': stage,
      'atMs': DateTime.now().millisecondsSinceEpoch,
      ...extra,
    });
    // ignore: avoid_print
    print('[voice-timing]$entry');
    _writes = _writes
        .catchError((Object _) {})
        .then((_) async {
          final file = File('$_diagnosticsRoot/voice-timing.jsonl');
          await file.parent.create(recursive: true);
          if (++_entries % 64 == 0 &&
              await file.exists() &&
              await file.length() > 1024 * 1024) {
            await file.writeAsString('');
          }
          await file.writeAsString('$entry\n', mode: FileMode.append);
        })
        .catchError((Object _) {});
  }
}
