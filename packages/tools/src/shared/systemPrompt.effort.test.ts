import test from "node:test";
import assert from "node:assert/strict";
import { buildProtocolDynamicSuffix } from "./systemPrompt.js";

test("conversational protocol suffix includes output-effort injection only", () => {
  const suffix = buildProtocolDynamicSuffix(new Set(["think"]), "conversational");
  assert.match(suffix, /\[OUTPUT EFFORT\]/);
  assert.doesNotMatch(suffix, /SHELL_RUNTIME_PROTOCOL/i);
});

test("non-conversational protocol suffix omits output effort (per-turn injection is authoritative)", () => {
  const suffix = buildProtocolDynamicSuffix(
    new Set(["write_file", "run_shell", "web_search"]),
    "coding"
  );
  assert.ok(suffix.length > 0);
  assert.doesNotMatch(suffix, /\[OUTPUT EFFORT\]/);
});

test("PROTOCOL_CORE documents live HTML chat embeds", async () => {
  const { PROTOCOL_CORE } = await import("./systemPrompt.js");
  assert.match(PROTOCOL_CORE, /live HTML/i);
  assert.match(PROTOCOL_CORE, /rehype-raw|raw HTML/i);
});
