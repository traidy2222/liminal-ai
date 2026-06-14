import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  prepareSandboxLab,
  readSandboxText,
  sandboxLabDefaultEnv,
} from "../src/sandboxLabBootstrap.js";

describe("sandboxLabBootstrap", () => {
  it("copies read-edit-verify fixture into temp root", () => {
    const session = prepareSandboxLab("read-edit-verify");
    try {
      assert.ok(existsSync(session.root));
      assert.equal(
        readSandboxText({ sandboxRoot: session.root }, "src/greeting.txt")?.trim(),
        "Hello, wirld!"
      );
    assert.equal(session.env.AGENT_WORKSPACE_ROOT, session.root);
    assert.equal(session.env.AGENT_STORAGE_LAYOUT, "legacy");
    assert.equal(session.env.AGENT_TOOL_LAZY, "1");
    } finally {
      session.cleanup();
      assert.equal(existsSync(session.root), false);
    }
  });

  it("copies research-lab fixture with corpus and source", () => {
    const session = prepareSandboxLab("research-lab");
    try {
      assert.ok(readSandboxText({ sandboxRoot: session.root }, "corpus/study_b.md")?.includes("32"));
      assert.ok(readSandboxText({ sandboxRoot: session.root }, "src/rate_limiter.ts")?.includes("16"));
    } finally {
      session.cleanup();
    }
  });

  it("sandboxLabDefaultEnv pins workspace root with legacy layout", () => {
    const env = sandboxLabDefaultEnv("/tmp/example");
    assert.equal(env.AGENT_WORKSPACE_ROOT, "/tmp/example");
    assert.equal(env.AGENT_STORAGE_LAYOUT, "legacy");
    assert.equal(env.AGENT_WORLD_CONTEXT, "0");
    assert.equal(env.AGENT_INTENT_INFERENCE, "0");
  });

  it("broken-ts fixture has intentional type error", () => {
    const session = prepareSandboxLab("broken-ts");
    try {
      const src = readFileSync(`${session.root}/src/app.ts`, "utf8");
      assert.match(src, /const n: number = name/);
    } finally {
      session.cleanup();
    }
  });
});
