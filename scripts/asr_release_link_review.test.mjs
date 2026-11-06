import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('the release-status link remains usable while release assets are being published', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const status = text.split(/\r?\n/).find(line => line.startsWith('**Release status:**'));
  assert.ok(status, 'README includes a release status');
  assert.match(status, /\[[^\]]+\]\(https:\/\/github\.com\/traidy2222\/liminal-ai\/releases\)/);
});
