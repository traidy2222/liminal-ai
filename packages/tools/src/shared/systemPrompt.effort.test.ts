import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "@liminal/core";
import { buildProtocolDynamicSuffix } from "./systemPrompt.js";

test("conversational turns do not append tool playbooks or duplicate output-effort policy", () => {
  const suffix = buildProtocolDynamicSuffix(new Set(["think"]), "conversational");
  assert.equal(suffix, "");
});

test("buildProtocolDynamicSuffix includes manifest when registry is passed", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "write_file",
    description: "write",
    parameters: { type: "object", properties: {} },
    handler: async () => ({ ok: true, output: "" }),
  });
  registry.seedActiveTools(["write_file"]);
  const suffix = buildProtocolDynamicSuffix(new Set(["write_file"]), "coding", registry);
  assert.match(suffix, /TOOL CAPABILITY MANIFEST/);
  assert.match(suffix, /registered_total=1/);
});

test("non-conversational protocol suffix omits output effort (per-turn injection is authoritative)", () => {
  const suffix = buildProtocolDynamicSuffix(
    new Set(["write_file", "run_shell", "web_search"]),
    "coding"
  );
  assert.ok(suffix.length > 0);
  assert.doesNotMatch(suffix, /\[OUTPUT EFFORT\]/);
});

test("PROTOCOL_CORE documents live HTML via dynamic suffix module", async () => {
  const { WEB_RICH_RENDERING_PROTOCOL } = await import("./harness_runtime_prompt.js");
  assert.match(WEB_RICH_RENDERING_PROTOCOL, /live HTML/i);
  assert.match(WEB_RICH_RENDERING_PROTOCOL, /rehype-raw|raw HTML/i);
});

test("ordinary browser work gets concise policy and relevant operational notes", async () => {
  const { PROTOCOL_CORE, buildInceptionMessages } = await import("./systemPrompt.js");
  const suffix = buildProtocolDynamicSuffix(["browser_open", "browser_act", "write_file", "connect_provider"]);
  assert.ok(PROTOCOL_CORE.length < 4000, "fixed policy must stay small");
  assert.doesNotMatch(PROTOCOL_CORE, /R-[A-Z]|Named rules|hypothesize\(\)|Known archive profiles/);
  assert.match(PROTOCOL_CORE, /configured permissions/);
  assert.match(suffix, /Browser:|Files:/);
  assert.doesNotMatch(suffix, /REA:|Mail:|Research:|Outlook|AgentCard|YouTube|IDA/);
  assert.equal(buildInceptionMessages()[1]!.content, PROTOCOL_CORE);
});
