import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  criticGateEnabled,
  distillArtifactHashFromOutput,
  extractExplicitRepoPaths,
  needsVerificationContinuation,
  userRequestsCritics,
  verifyToolsEnabled,
} from "./capability_gates.js";

describe("capability_gates", () => {
  it("verifyToolsEnabled when CRITIC_REQUIRE=1 even if VERIFY_TOOLS=0", () => {
    const prefs = {
      version: 1 as const,
      harness: {
        env: {
          AGENT_VERIFY_TOOLS: "0",
          AGENT_CRITIC_REQUIRE: "1",
        },
      },
      updatedAt: 0,
    };
    assert.equal(verifyToolsEnabled(prefs), true);
    assert.equal(criticGateEnabled(prefs), true);
  });

  it("extractExplicitRepoPaths finds packages paths", () => {
    const paths = extractExplicitRepoPaths(
      "read_file packages/core/src/agent.ts and packages/core/src/dispatcher.ts"
    );
    assert.ok(paths.includes("packages/core/src/agent.ts"));
    assert.ok(paths.includes("packages/core/src/dispatcher.ts"));
  });

  it("distillArtifactHashFromOutput parses hash from NEXT_ACTIONS_JSON", () => {
    const out =
      'Summary…\nNEXT_ACTIONS_JSON: {"read_artifact":{"hash":"abc123def456"}}';
    assert.equal(distillArtifactHashFromOutput(out), "abc123def456");
  });

  it("needsVerificationContinuation when critics named but not used", () => {
    const msg =
      "run evidence_critic, path_critic, and policy_critic then finalize";
    assert.equal(userRequestsCritics(msg), true);
    const gate = needsVerificationContinuation({
      userMessage: msg,
      toolsUsed: ["read_file", "repo_map", "plan"],
      prefs: null,
      gateAttempted: false,
    });
    assert.equal(gate.needed, true);
    if (gate.needed) {
      assert.ok(gate.missing.includes("evidence_critic"));
      assert.ok(gate.missing.includes("path_critic"));
    }
  });

  it("needsVerificationContinuation is false after gate attempted", () => {
    const gate = needsVerificationContinuation({
      userMessage: "run evidence_critic",
      toolsUsed: ["read_file"],
      prefs: null,
      gateAttempted: true,
    });
    assert.equal(gate.needed, false);
  });
});
