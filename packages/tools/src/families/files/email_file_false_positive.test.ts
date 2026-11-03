import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWithWorkspaceRoot } from "@liminal/core";
import { writeFileTool } from "./write_file.js";

const schematics = '<!DOCTYPE html><html><body><h1>Mark VII schematics</h1><table><tr><th>Component</th><th>Revision</th></tr><tr><td>Display</td><td>V2</td></tr></table></body></html>';

for (const [filename, content] of [
  ["mark-vii-schematics.html", schematics],
  ["src/index.html", "<!DOCTYPE html><html><body><p>Hello world, welcome to the dashboard.</p></body></html>"],
  ["docs/message-protocol.md", "To: example@example.test\nSubject: Protocol example\n\nThese headers document an example message format; this file is documentation."],
  ["templates/outreach-email.html", "<!DOCTYPE html><html><body><table><tr><td>Dear team, this is an email template asset for the application.</td></tr></table></body></html>"],
] as const) {
  test(`write_file saves ${filename} without inferring outbound mail`, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liminal-file-content-"));
    try {
      await runWithWorkspaceRoot(root, async () => {
        const result = await writeFileTool.handler({ path: filename, content });
        assert.equal(result.ok, true, result.ok ? undefined : result.error);
        assert.equal(await readFile(path.join(root, filename), "utf8"), content);
      });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

test("HTML schematics still require confirmation before replacing a substantial existing file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-file-overwrite-"));
  const original = schematics.repeat(4);
  try {
    await writeFile(path.join(root, "mark-vii-schematics.html"), original);
    await runWithWorkspaceRoot(root, async () => {
      const result = await writeFileTool.handler({ path: "mark-vii-schematics.html", content: schematics, mode: "overwrite" });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.error, /confirm_overwrite/);
      assert.equal(await readFile(path.join(root, "mark-vii-schematics.html"), "utf8"), original);
    });
  } finally { await rm(root, { recursive: true, force: true }); }
});
