import 'dart:convert';
import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:liminal_desktop/core/update/native_update_helper.dart';

void main() {
  test('detached Node helper acknowledges startup with paths containing spaces',
      () async {
    final root = await Directory.systemTemp.createTemp('liminal helper ');
    try {
      await File('${root.path}/apply-desktop-update.mjs').writeAsString('''
import fs from 'node:fs';
const args=process.argv.slice(2);
fs.writeFileSync(args[args.indexOf('--ready-file')+1],JSON.stringify(args));
''');
      await startWindowsUpdateHelper(
          helperDirectory: root.path,
          exeDir: '${root.path}/installed app',
          archivePath: '${root.path}/update archive.zip',
          parentPid: pid);
      final args =
          jsonDecode(await File('${root.path}/helper-ready').readAsString())
              as List;
      expect(args[args.indexOf('--exe-dir') + 1], '${root.path}/installed app');
      expect(args[args.indexOf('--archive') + 1],
          '${root.path}/update archive.zip');
      expect(args[args.indexOf('--relaunch-pid') + 1], '$pid');
    } finally {
      await root.delete(recursive: true);
    }
  });

  test('a helper that dies before initialization cannot authorize app exit',
      () async {
    final root = await Directory.systemTemp.createTemp('liminal dead helper ');
    try {
      await File('${root.path}/apply-desktop-update.mjs')
          .writeAsString('process.exit(1);');
      await expectLater(
          startWindowsUpdateHelper(
              helperDirectory: root.path,
              exeDir: root.path,
              archivePath: '${root.path}/unused.zip',
              parentPid: pid,
              startupTimeout: const Duration(milliseconds: 500)),
          throwsStateError);
      expect(await File('${root.path}/helper-ready').exists(), isFalse);
    } finally {
      await root.delete(recursive: true);
    }
  });
}
