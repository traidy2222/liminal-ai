import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "@liminal/core";
import { buildProtocolDynamicSuffix } from "./systemPrompt.js";

test("conversational protocol suffix includes output-effort injection only", () => {
  const suffix = buildProtocolDynamicSuffix(new Set(["think"]), "conversational");
  assert.match(suffix, /\[OUTPUT EFFORT\]/);
  assert.doesNotMatch(suffix, /Shell runtime/i);
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
