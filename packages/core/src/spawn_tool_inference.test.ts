import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpawnToolInferencePrompt,
  parseSpawnToolInferencePayload,
} from "./spawn_tool_inference.js";

test("parseSpawnToolInferencePayload validates families and tool names", () => {
  const p = parseSpawnToolInferencePayload({
    tool_families: ["web", "INVALID", "shell"],
    activate_tools: ["run_tests", "bad name", "web_fetch"],
    rationale: "needs research + tests",
  });
  assert.ok(p.families.includes("web"));
  assert.ok(p.families.includes("shell"));
  assert.ok(p.families.includes("files_edit"));
  assert.ok(!p.families.includes("invalid"));
  assert.deepEqual(p.activateTools, ["run_tests", "web_fetch"]);
  assert.equal(p.rationale, "needs research + tests");
});

test("buildSpawnToolInferencePrompt includes objective and allowlist", () => {
  const prompt = buildSpawnToolInferencePrompt(
    {
      goal: "audit-auth",
      userPrompt: "Fetch npm audit results and grep for JWT usage in src/auth",
      systemPrompt: "You are a security auditor.",
      toolNames: ["read_file", "grep_file", "web_fetch", "think"],
    },
    ["read_file", "think"]
  );
  assert.match(prompt, /security auditor/i);
  assert.match(prompt, /JWT usage/i);
  assert.match(prompt, /allowlist ONLY/i);
  assert.match(prompt, /read_file/);
});
