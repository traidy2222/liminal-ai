import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ToolRegistry } from "@liminal/core";
import {
  bootstrapLiminalAppsTools,
  createLiminalAppTools,
  LIMINAL_APP_TOOL_NAMES,
} from "./liminal_apps.js";
import type { LiminalAppManagerPort, LiminalAppSpec, SpawnAppInput } from "@liminal/core";

const priorLiminalApps = process.env["AGENT_LIMINAL_APPS"];

before(() => {
  process.env["AGENT_LIMINAL_APPS"] = "1";
});

after(() => {
  if (priorLiminalApps === undefined) delete process.env["AGENT_LIMINAL_APPS"];
  else process.env["AGENT_LIMINAL_APPS"] = priorLiminalApps;
});

function mockAppManager(): LiminalAppManagerPort {
  const specs = new Map<string, LiminalAppSpec>();
  return {
    isEnabled: () => true,
    listApps: async () => [...specs.values()],
    listAppsWithCaches: async () => ({ apps: [...specs.values()], caches: {} }),
    spawnApp: async (input: SpawnAppInput) => {
      const spec: LiminalAppSpec = {
        v: 1,
        id: input.id ?? "weather_test",
        type: input.type,
        title: input.title ?? "Test",
        props: input.props,
        refresh: input.refresh ?? { interval_min: 45 },
        placement: input.placement ?? { width: 300, height: 240 },
        shell: input.shell ?? { mode: "widget", frameless: true, always_on_top: false },
        auto_open: input.auto_open !== false,
        source: input.source ?? "model",
        created_at: Date.now(),
        updated_at: Date.now(),
      };
      specs.set(spec.id, spec);
      return spec;
    },
    updateApp: async (id, patch) => {
      const cur = specs.get(id);
      if (!cur) throw new Error("missing");
      const next = {
        ...cur,
        title: patch.title ?? cur.title,
        props: patch.props ?? cur.props,
        refresh: patch.refresh ?? cur.refresh,
        placement: patch.placement ?? cur.placement,
        shell: patch.shell ?? cur.shell,
        auto_open: patch.auto_open ?? cur.auto_open,
        updated_at: Date.now(),
      };
      specs.set(id, next);
      return next;
    },
    closeApp: async (id) => specs.delete(id),
    refreshApp: async () => ({
      fetched_at: Date.now(),
      ok: true,
      data: {},
    }),
  };
}

test("bootstrapLiminalAppsTools activates liminal_apps when lazy", () => {
  const registry = new ToolRegistry();
  const tools = createLiminalAppTools(registry, mockAppManager());
  for (const t of Object.values(tools)) registry.register(t);
  registry.setToolFamilyLookup(
    new Map(LIMINAL_APP_TOOL_NAMES.map((name) => [name, "liminal_apps"]))
  );
  registry.setLazyToolLoading(true);
  registry.seedActiveTools([]);
  const newly = bootstrapLiminalAppsTools(registry);
  assert.ok(newly.length > 0);
  assert.ok(registry.isActive("spawn_app"));
  assert.ok(registry.isActive("preview_app_html"));
});

test("spawn_app rejects duplicate html widget without explicit new id", async () => {
  const registry = new ToolRegistry();
  const mgr = mockAppManager();
  const tools = createLiminalAppTools(registry, mgr);
  const spawn = tools.spawnAppTool;
  await spawn.handler({
    type: "html",
    props: { html: "<!DOCTYPE html><html><body>one</body></html>" },
  });
  const again = await spawn.handler({
    type: "html",
    props: { html: "<!DOCTYPE html><html><body>two</body></html>" },
  });
  assert.equal(again.ok, false);
  assert.match(String(again.error ?? ""), /update_app/i);
});
