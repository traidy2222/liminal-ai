import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  AgentEmitter,
  ToolRegistry,
  ToolDispatcher,
  runWithWorkspaceRoot,
} from "@liminal/core";
import { executeCodeTool } from "./execute_code.js";

for (const language of [undefined, "javascript"])
  test(`execute_code uses ${language ?? "documented Python default"} through normal validation and approval`, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liminal-code-default-"));
    const previous = process.env.AGENT_GLOBAL_STORAGE_ROOT;
    process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
    t.after(async () => {
      if (previous === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT;
      else process.env.AGENT_GLOBAL_STORAGE_ROOT = previous;
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert(path.basename(root).startsWith("liminal-code-default-"));
      await rm(root, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 20,
      });
    });
    const emitter = new AgentEmitter();
    const registry = new ToolRegistry();
    registry.register(executeCodeTool);
    let approvals = 0;
    emitter.on("tool_approval", (e) => {
      approvals++;
      e.resolve({ decision: "approve" });
    });
    const dispatcher = new ToolDispatcher(registry, emitter);
    const args = language
      ? { language, code: "console.log('OWNED_CODE_FIXTURE')" }
      : { code: "print('OWNED_CODE_FIXTURE')" };
    const result = await runWithWorkspaceRoot(root, () =>
      dispatcher.dispatch("owned-code", "execute_code", JSON.stringify(args)),
    );
    assert(result.ok, result.ok ? "" : result.error);
    assert.equal(approvals, 1);
    const data = JSON.parse(result.output);
    assert.equal(data.exit_code, 0);
    assert.equal(data.stdout.trim(), "OWNED_CODE_FIXTURE");
  });
