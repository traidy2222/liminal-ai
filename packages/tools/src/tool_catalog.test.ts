/**
 * Catalog reachability guard.
 *
 * Under lazy tool loading (AGENT_TOOL_LAZY=1, the default) the model only ever
 * sees tools that are in the always-loaded seed OR in a TOOL_FAMILIES entry it
 * can activate. A tool that is registered but belongs to no family and is not
 * in the seed is a dead tool: the model can never call it, and
 * `activate_tool_family` cannot surface it. This test registers the full tool
 * set against a real (offline) harness and fails if any registered tool is
 * unreachable, or if a tool is double-listed across families.
 */
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync } from "node:fs";
import { AgentHarness } from "@liminal/core";
import { registerAllTools } from "./index.js";
import {
  TOOL_FAMILIES,
  TOOLS_LISTED_IN_MULTIPLE_FAMILIES,
  getCoreAlwaysToolNames,
} from "./tool_catalog.js";

// Isolate global storage so no persisted dynamic tools / API / MCP connections
// from the developer's ~/.liminal leak in and make this test machine-dependent.
process.env["AGENT_GLOBAL_STORAGE_ROOT"] = mkdtempSync(path.join(os.tmpdir(), "liminal-catalog-test-"));
process.env["AGENT_PLUGIN_DIR"] = "";

function buildHarness(): AgentHarness {
  const harness = new AgentHarness({
    openRouterApiKey: "test-key-not-used-offline",
    model: "test/model",
    baseURL: "https://example.invalid/v1",
    maxToolRoundsPerTurn: 4,
    context: {
      modelMaxTokens: 128_000,
      thresholdFraction: 0.6,
      inceptionMessages: [
        { role: "system", content: "test-inception-0" },
        { role: "system", content: "test-inception-1" },
      ],
    },
  });
  harness.emitter.on("error", () => {});
  return harness;
}

// Tool names that are intentionally registered but not model-facing via a
// family (dynamically-named external connections). None should appear with an
// isolated storage root, but allow the prefixes defensively.
function isExternallyNamed(name: string): boolean {
  return name.startsWith("api_") || name.startsWith("mcp_");
}

test("no tool is listed in more than one family", () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const [family, def] of Object.entries(TOOL_FAMILIES)) {
    for (const tool of def.tools) {
      if (TOOLS_LISTED_IN_MULTIPLE_FAMILIES.has(tool)) continue;
      const prev = seen.get(tool);
      if (prev) dupes.push(`${tool} (in ${prev} and ${family})`);
      else seen.set(tool, family);
    }
  }
  assert.deepEqual(dupes, [], `tools double-listed across families: ${dupes.join(", ")}`);
});

test("every registered tool is reachable via the always-set or a family", async () => {
  const harness = buildHarness();
  await registerAllTools(harness.registry, harness.emitter, harness);

  const reachable = new Set<string>([
    ...getCoreAlwaysToolNames(true),
    ...Object.values(TOOL_FAMILIES).flatMap((f) => f.tools),
  ]);

  const orphans = harness.registry
    .getToolNames()
    .filter((n) => !reachable.has(n) && !isExternallyNamed(n))
    .sort();

  assert.deepEqual(
    orphans,
    [],
    `Registered but unreachable under lazy loading (add to a TOOL_FAMILIES entry or the always-set): ${orphans.join(", ")}`
  );
});

test("speak is registered when TTS is enabled but not in static always-set", async () => {
  const prevTts = process.env["AGENT_TTS_ENABLED"];
  const prevLazy = process.env["AGENT_TOOL_LAZY"];
  process.env["AGENT_TTS_ENABLED"] = "1";
  process.env["AGENT_TOOL_LAZY"] = "1";
  try {
    const harness = buildHarness();
    await registerAllTools(harness.registry, harness.emitter, harness);
    assert.ok(harness.registry.has("speak"), "speak should be registered");
    assert.equal(
      harness.registry.isActive("speak"),
      false,
      "speak is voice-mode only — activated per send when mic is on"
    );
    assert.equal(
      getCoreAlwaysToolNames(true).includes("speak"),
      false,
      "speak should not be in the static lazy always-set"
    );
  } finally {
    if (prevTts === undefined) delete process.env["AGENT_TTS_ENABLED"];
    else process.env["AGENT_TTS_ENABLED"] = prevTts;
    if (prevLazy === undefined) delete process.env["AGENT_TOOL_LAZY"];
    else process.env["AGENT_TOOL_LAZY"] = prevLazy;
  }
});

test("new file tools are registered and reachable", async () => {
  const harness = buildHarness();
  await registerAllTools(harness.registry, harness.emitter, harness);
  for (const name of ["delete_file", "find_files"]) {
    assert.ok(harness.registry.has(name), `${name} should be registered`);
  }
});

test("registerAllTools is idempotent on harness retry", async () => {
  const harness = buildHarness();
  await registerAllTools(harness.registry, harness.emitter, harness);
  await registerAllTools(harness.registry, harness.emitter, harness);
  assert.ok(harness.registry.has("calendar_rest_list_events"));
  assert.ok(harness.registry.has("slack_search_messages"));
});
