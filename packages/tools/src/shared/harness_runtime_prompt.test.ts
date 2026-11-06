import test from "node:test";
import assert from "node:assert/strict";
import { ToolRegistry } from "@liminal/core";
import {
  buildHarnessCapabilityDomains,
  buildHarnessProductFacts,
  buildHarnessToolManifest,
  countCatalogFamilies,
  countCatalogToolNames,
} from "./harness_runtime_prompt.js";
import { PROTOCOL_CORE } from "./systemPrompt.js";

test("catalog tool counts are derived from TOOL_FAMILIES", () => {
  assert.ok(countCatalogToolNames() > 50);
  assert.ok(countCatalogFamilies() > 10);
});

test("product facts omit hardcoded 245+ tool count", () => {
  const facts = buildHarnessProductFacts({ registeredTotal: 312, lazyMode: true });
  assert.match(facts, /312 registered tools/);
  assert.doesNotMatch(facts, /245\+/);
  assert.match(facts, /TOOL CAPABILITY MANIFEST/);
});

test("PROTOCOL_CORE uses dynamic catalog counts not static 245+", () => {
  assert.doesNotMatch(PROTOCOL_CORE, /245\+/);
  assert.match(PROTOCOL_CORE, /TOOL CAPABILITY MANIFEST/);
});

test("buildHarnessToolManifest groups tools by family", () => {
  const registry = new ToolRegistry();
  registry.register({
    name: "read_file",
    description: "read",
    parameters: { type: "object", properties: {} },
    handler: async () => ({ ok: true, output: "" }),
  });
  registry.register({
    name: "web_search",
    description: "search",
    parameters: { type: "object", properties: {} },
    handler: async () => ({ ok: true, output: "" }),
  });
  registry.setToolFamilyLookup(new Map([
    ["read_file", "files_read"],
    ["web_search", "web"],
  ]));
  registry.setLazyToolLoading(true);
  registry.seedActiveTools(["read_file"]);

  const manifest = buildHarnessToolManifest(registry);
  assert.match(manifest, /TOOL CAPABILITY MANIFEST/);
  assert.match(manifest, /files_read: active=1\/1/);
  assert.match(manifest, /web: active=0\/1/);
  assert.doesNotMatch(manifest, /web_search|read_file|inactive_tools:/);
});

test("a large inactive MCP catalog does not expand the model prompt", () => {
  const registry = new ToolRegistry();
  const families = new Map<string, string>();
  for (let i = 0; i < 1000; i++) {
    const name = `mcp_fixture_unloaded_${i}`;
    registry.register({ name, description: "fixture", parameters: { type: "object", properties: {} }, handler: async () => ({ ok: true, output: "" }) });
    families.set(name, "connector:fixture");
  }
  registry.setToolFamilyLookup(families);
  registry.setLazyToolLoading(true);
  const manifest = buildHarnessToolManifest(registry);
  assert.match(manifest, /registered_total=1000; active_total=0/);
  assert.match(manifest, /connector:fixture: active=0\/1000/);
  assert.doesNotMatch(manifest, /mcp_fixture_unloaded_/);
  assert.ok(manifest.length < 1000);
});

test("buildHarnessCapabilityDomains reflects registered tools", () => {
  const domains = buildHarnessCapabilityDomains(["read_file", "run_workflow", "gmail_send_message"]);
  assert.match(domains, /file read\/write/);
  assert.match(domains, /multi-agent orchestration/);
  assert.match(domains, /connected SaaS integrations/);
});
