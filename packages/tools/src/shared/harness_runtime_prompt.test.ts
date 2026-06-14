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
  assert.match(manifest, /inactive_tools: web_search/);
});

test("buildHarnessCapabilityDomains reflects registered tools", () => {
  const domains = buildHarnessCapabilityDomains(["read_file", "run_workflow", "gmail_send_message"]);
  assert.match(domains, /file read\/write/);
  assert.match(domains, /multi-agent orchestration/);
  assert.match(domains, /connected SaaS integrations/);
});
