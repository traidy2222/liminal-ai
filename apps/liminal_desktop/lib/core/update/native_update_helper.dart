import 'dart:io';
import 'package:path/path.dart' as p;

/// Windows PowerShell can exit before executing a detached -File invocation.
/// Launch the existing Node updater directly and require a startup acknowledgement
/// before the desktop exits. The helper waits for [parentPid] before swapping.
Future<void> startWindowsUpdateHelper({
  required String helperDirectory,
  required String exeDir,
  required String archivePath,
  required int parentPid,
  Duration startupTimeout = const Duration(seconds: 8),
}) async {
  final ready = File(p.join(helperDirectory, 'helper-ready'));
  if (await ready.exists()) throw StateError('Update helper already started');
  final child = await Process.start(
      'node',
      [
        p.join(helperDirectory, 'apply-desktop-update.mjs'),
        '--mode',
        'app',
        '--exe-dir',
        exeDir,
        '--archive',
        archivePath,
        '--platform',
        'windows',
        '--relaunch-pid',
        '$parentPid',
        '--ready-file',
        ready.path,
      ],
      workingDirectory: helperDirectory,
      mode: ProcessStartMode.detached);
  final deadline = DateTime.now().add(startupTimeout);
  while (DateTime.now().isBefore(deadline)) {
    if (await ready.exists()) return;
    await Future<void>.delayed(const Duration(milliseconds: 25));
  }
  Process.killPid(child.pid);
  throw StateError(
      'Update helper did not start; the current app will stay open.');
}
