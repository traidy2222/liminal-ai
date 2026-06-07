import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import { AgentHarness } from "./agent.js";
import { hasPersistedPersonaProfile } from "./persona_artifacts.js";

const env = { ...process.env };
const roots: string[] = [];

function tempRoot(): string {
  const dir = join(tmpdir(), `liminal-persona-gate-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
}

afterEach(() => {
  process.env = { ...env };
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("hasPersistedPersonaProfile", () => {
  it("returns false when runtime_profile.json is absent", () => {
    const globalRoot = tempRoot();
    process.env["AGENT_GLOBAL_STORAGE_ROOT"] = globalRoot;
    process.env["AGENT_STORAGE_LAYOUT"] = "";
    assert.equal(hasPersistedPersonaProfile(), false);
  });

  it("returns true when global runtime_profile.json exists", () => {
    const globalRoot = tempRoot();
    process.env["AGENT_GLOBAL_STORAGE_ROOT"] = globalRoot;
    process.env["AGENT_STORAGE_LAYOUT"] = "";
    const active = join(globalRoot, "persona", "active");
    mkdirSync(active, { recursive: true });
    writeFileSync(join(active, "runtime_profile.json"), "{}");
    assert.equal(hasPersistedPersonaProfile(), true);
  });
});

describe("AgentHarness.isPersonaBootstrapCompleted", () => {
  it("requires persona file when bootstrap marked complete with a custom source prompt", () => {
    const globalRoot = tempRoot();
    process.env["AGENT_GLOBAL_STORAGE_ROOT"] = globalRoot;
    process.env["AGENT_STORAGE_LAYOUT"] = "";
    const harness = new AgentHarness({
      apiKey: "test-key",
      runtimePreferences: {
        version: 1,
        updatedAt: Date.now(),
        persona: {
          bootstrapCompleted: true,
          sourcePrompt: "noir narrator",
          activeProfile: null,
        },
      },
    });
    assert.equal(harness.isPersonaBootstrapCompleted(), false);
  });

  it("allows skip completion without persona file", () => {
    const globalRoot = tempRoot();
    process.env["AGENT_GLOBAL_STORAGE_ROOT"] = globalRoot;
    const harness = new AgentHarness({
      apiKey: "test-key",
      runtimePreferences: {
        version: 1,
        updatedAt: Date.now(),
        persona: {
          bootstrapCompleted: true,
          sourcePrompt: "",
          activeProfile: null,
        },
      },
    });
    assert.equal(harness.isPersonaBootstrapCompleted(), true);
  });

  it("allows default completion without persona file", () => {
    const harness = new AgentHarness({
      apiKey: "test-key",
      runtimePreferences: {
        version: 1,
        updatedAt: Date.now(),
        persona: {
          bootstrapCompleted: true,
          sourcePrompt: "default",
          activeProfile: null,
        },
      },
    });
    assert.equal(harness.isPersonaBootstrapCompleted(), true);
  });
});
