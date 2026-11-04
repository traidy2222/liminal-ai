import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('ASR API docs distinguish configured cloud costs and provisional attachment ownership', () => {
  const text = readFileSync(new URL('../docs/reference/web-api.md', import.meta.url), 'utf8');
  assert.match(text, /cloud model[\s\S]{0,250}provider host/);
  assert.match(text, /languageConfidence[\s\S]{0,100}optional/);
  assert.match(text, /provisional: true[\s\S]{0,80}no `attachmentId`/);
});
