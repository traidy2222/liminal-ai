import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
test('desktop upload cancellation and cloud dropdown regressions', () => {
  const flutter = process.env.FLUTTER_TEST_BIN || 'flutter';
  const result = spawnSync(flutter, ['test', '--no-pub', 'test/asr_review_test.dart'], {
    cwd: new URL('../apps/liminal_desktop/', import.meta.url), encoding: 'utf8',
    shell: process.platform === 'win32', windowsHide: true, timeout: 120000,
  });
  assert.equal(result.status, 0, (result.stdout || '') + (result.stderr || ''));
});
