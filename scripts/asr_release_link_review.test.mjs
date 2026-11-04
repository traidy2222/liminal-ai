import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('the release-status link remains usable while release assets are being published', () => {
  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(text, /\[Desktop 0\.1\.24\]\(https:\/\/github\.com\/traidy2222\/liminal-ai\/releases\)/);
});
