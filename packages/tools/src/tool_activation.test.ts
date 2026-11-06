import assert from "node:assert/strict";
import test from "node:test";
import { ToolRegistry } from "@liminal/core";
import { createToolDiscoveryTools } from "./tool_activation.js";
import {getCoreAlwaysToolNames} from './tool_catalog.js';

test('browser-first exposes search and discovery routes a web request to usable browser tools',async()=>{
 const before=process.env.AGENT_WEB_SEARCH_FETCH,active=process.env.AGENT_BROWSER_ALWAYS_ACTIVE;
 try{
  process.env.AGENT_WEB_SEARCH_FETCH='0';process.env.AGENT_BROWSER_ALWAYS_ACTIVE='0';
  assert.ok(getCoreAlwaysToolNames(true).includes('browser_search'));
  const registry=registryWithTool('browser_search','browser');
  const tools=createToolDiscoveryTools(registry);
  const listed=await tools.listToolFamiliesTool.handler({task_hint:'search the web'});assert.ok(listed.ok);assert.match(listed.output,/Recommended next family.*browser/);assert.ok(listed.output.length<1000);
  const loaded=await tools.activateToolFamilyTool.handler({family:'web'});assert.ok(loaded.ok);assert.match(loaded.output,/Family "browser" activated/);assert.ok(registry.isActive('browser_search'));
  process.env.AGENT_WEB_SEARCH_FETCH='1';assert.ok(!getCoreAlwaysToolNames(true).includes('browser_search'));
 }finally{if(before===undefined)delete process.env.AGENT_WEB_SEARCH_FETCH;else process.env.AGENT_WEB_SEARCH_FETCH=before;if(active===undefined)delete process.env.AGENT_BROWSER_ALWAYS_ACTIVE;else process.env.AGENT_BROWSER_ALWAYS_ACTIVE=active;}
});

function registryWithTool(name: string, family?: string, lazy = true): ToolRegistry {
  const registry = new ToolRegistry();
  registry.setLazyToolLoading(lazy);
  registry.register({
    name,
    description: "Offline activation fixture",
    parameters: { type: "object", properties: {} },
    handler: async () => ({ ok: true, output: "fixture" }),
  });
  if (family) registry.setToolFamilyLookup(new Map([[name, family]]));
  return registry;
}

for (const fixture of [
  { label: "static catalog family", tool: "run_shell", family: "shell" },
  { label: "dynamic connector", tool: "mcp_fixture_inspect", family: "connector:fixture", mapped: "connector:fixture" },
  { label: "umbrella alias", tool: "mcp_fixture_mail", family: "google_workspace", mapped: "google_mail" },
]) {
  test(`activating an already active ${fixture.label} succeeds`, async () => {
    const registry = registryWithTool(fixture.tool, fixture.mapped);
    const tool = createToolDiscoveryTools(registry).activateToolFamilyTool;
    const first = await tool.handler({ family: fixture.family });
    assert.equal(first.ok, true);
    assert.equal(registry.isActive(fixture.tool), true);
    const namesBefore = registry.getActiveToolNames();
    const second = await tool.handler({ family: fixture.family });
    assert(second.ok, second.ok ? undefined : second.error);
    assert.match(second.output, /already active/);
    assert.deepEqual(registry.getActiveToolNames(), namesBefore);
  });
}

test("activating a registered family succeeds when lazy loading is off", async () => {
  const registry = registryWithTool("run_shell", undefined, false);
  const result = await createToolDiscoveryTools(registry).activateToolFamilyTool.handler({ family: "shell" });
  assert(result.ok, result.ok ? undefined : result.error);
  assert.equal(registry.isActive("run_shell"), true);
  assert.match(result.output, /already active/);
});

test("a family with no registered tools still fails", async () => {
  const registry = registryWithTool("run_shell");
  const tool = createToolDiscoveryTools(registry).activateToolFamilyTool;
  for (const family of ["git", "connector:missing"]) {
    const result = await tool.handler({ family });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.error, /has no tools registered/);
  }
});

test("unknown family names remain errors even when other tools are active", async () => {
  const registry = registryWithTool("run_shell", undefined, false);
  const result = await createToolDiscoveryTools(registry).activateToolFamilyTool.handler({ family: "missing_family" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Unknown family/);
});
