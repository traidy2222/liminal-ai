import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runWithWorkspaceRoot } from "@liminal/core";
import { listDirTool } from "./list_dir.js";
import { findFilesTool } from "./find_files.js";

async function fixture(action: (root: string) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-list-dir-"));
  try { await action(root); }
  finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("liminal-list-dir-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
}

test("relative directory and glob calls stay inside concurrent chat workspaces, not process cwd", async () => fixture(async root => {
  const a = path.join(root, "chat-a"), b = path.join(root, "chat-b");
  await Promise.all([a, b].map(ws => fs.mkdir(path.join(ws, "nested"), { recursive: true })));
  await fs.writeFile(path.join(a, "a.txt"), "a"); await fs.writeFile(path.join(b, "b.txt"), "b");
  await fs.writeFile(path.join(a, ".hidden"), "hidden");
  await fs.writeFile(path.join(a, "nested/deep.txt"), "deep");
  const cwd = process.cwd();
  await Promise.all([a, b].map((workspace, index) => runWithWorkspaceRoot(workspace, async () => {
    await new Promise(resolve => setTimeout(resolve, index ? 1 : 5));
    const result = await listDirTool.handler({ path: "." });
    assert(result.ok, result.ok ? undefined : result.error);
    assert.deepEqual(result.output.split("\n").sort(), index ? ["b.txt", "nested/"] : ["a.txt", "nested/"]);
    const glob = await findFilesTool.handler({ pattern: "**/*.txt" });
    assert(glob.ok); assert.match(glob.output, index ? /b\.txt/ : /a\.txt/);
    assert.doesNotMatch(glob.output, index ? /a\.txt/ : /b\.txt/);
  })));
  await runWithWorkspaceRoot(a, async () => {
    const nested = await listDirTool.handler({ path: "nested" }); assert(nested.ok); assert.equal(nested.output, "deep.txt");
    const hidden = await listDirTool.handler({ path: ".", show_hidden: true }); assert(hidden.ok); assert.match(hidden.output, /\.hidden/);
  });
  assert.equal(process.cwd(), cwd);
}));

test("workspace binding rejects escapes while default mode preserves explicit external access", async () => fixture(async root => {
  const workspace = path.join(root, "workspace"), external = path.join(root, "external");
  await fs.mkdir(workspace); await fs.mkdir(external); await fs.writeFile(path.join(external, "outside.txt"), "outside");
  const previous = process.env.AGENT_WORKSPACE_BOUND;
  try {
    await runWithWorkspaceRoot(workspace, async () => {
      process.env.AGENT_WORKSPACE_BOUND = "1";
      for (const requested of ["../external", external]) {
        const denied = await listDirTool.handler({ path: requested });
        assert.equal(denied.ok, false); if (!denied.ok) assert.match(denied.error, /escapes workspace root/);
      }
      process.env.AGENT_WORKSPACE_BOUND = "0";
      const allowed = await listDirTool.handler({ path: "../external" });
      assert(allowed.ok); assert.equal(allowed.output, "outside.txt");
    });
  } finally { if (previous === undefined) delete process.env.AGENT_WORKSPACE_BOUND; else process.env.AGENT_WORKSPACE_BOUND = previous; }
}));

test("directory errors report the resolved workspace path and retain empty-directory behavior", async () => fixture(async root => {
  await fs.writeFile(path.join(root, "file.txt"), "text"); await fs.mkdir(path.join(root, "empty"));
  await runWithWorkspaceRoot(root, async () => {
    const empty = await listDirTool.handler({ path: "empty" }); assert(empty.ok); assert.equal(empty.output, "(empty directory)");
    for (const [requested, pattern] of [["missing", /Directory does not exist/], ["file.txt", /not a directory/]] as const) {
      const failure = await listDirTool.handler({ path: requested }); assert.equal(failure.ok, false);
      if (!failure.ok) { assert.match(failure.error, pattern); assert(failure.error.includes(path.join(root, requested))); }
    }
    const blank = await listDirTool.handler({ path: " " }); assert.equal(blank.ok, false);
  });
}));
