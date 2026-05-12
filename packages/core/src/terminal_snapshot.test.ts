import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { gatherExternalTerminalSnapshots } from "./terminal_snapshot.js";

test("gatherExternalTerminalSnapshots parses and redacts terminal metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "term-snap-"));
  const termsDir = path.join(root, "terms");
  await mkdir(termsDir, { recursive: true });
  await writeFile(
    path.join(termsDir, "1.txt"),
    [
      "---",
      "pid: 1234",
      "cwd: /tmp/project",
      "last_command: export API_KEY=abcd1234",
      "last_exit_code: 0",
      "---",
      "token=supersecret",
      "normal line",
    ].join("\n"),
    "utf8"
  );

  const prev = {
    ctx: process.env["AGENT_EXTERNAL_TERMINAL_CONTEXT"],
    dir: process.env["AGENT_EXTERNAL_TERMINAL_DIR"],
    roots: process.env["AGENT_EXTERNAL_TERMINAL_ALLOW_ROOTS"],
  };
  process.env["AGENT_EXTERNAL_TERMINAL_CONTEXT"] = "1";
  process.env["AGENT_EXTERNAL_TERMINAL_DIR"] = termsDir;
  process.env["AGENT_EXTERNAL_TERMINAL_ALLOW_ROOTS"] = root;

  try {
    const summary = await gatherExternalTerminalSnapshots();
    assert.ok(summary);
    assert.equal(summary?.entries.length, 1);
    const entry = summary!.entries[0]!;
    assert.equal(entry.pid, 1234);
    assert.equal(entry.lastExitCode, 0);
    assert.ok((entry.lastCommand ?? "").includes("[REDACTED]"));
    assert.ok(entry.outputPreview.join("\n").includes("[REDACTED]"));
  } finally {
    if (prev.ctx === undefined) delete process.env["AGENT_EXTERNAL_TERMINAL_CONTEXT"];
    else process.env["AGENT_EXTERNAL_TERMINAL_CONTEXT"] = prev.ctx;
    if (prev.dir === undefined) delete process.env["AGENT_EXTERNAL_TERMINAL_DIR"];
    else process.env["AGENT_EXTERNAL_TERMINAL_DIR"] = prev.dir;
    if (prev.roots === undefined) delete process.env["AGENT_EXTERNAL_TERMINAL_ALLOW_ROOTS"];
    else process.env["AGENT_EXTERNAL_TERMINAL_ALLOW_ROOTS"] = prev.roots;
    await rm(root, { recursive: true, force: true });
  }
});

