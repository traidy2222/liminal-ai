import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildAppSpecFromSpawn } from "./app_spec.js";
import { getApp, listApps, removeApp, upsertApp, writeAppCache, readAppCache } from "./app_store.js";

describe("liminal_apps app_store", () => {
  let prevRoot: string | undefined;

  before(async () => {
    prevRoot = process.env["AGENT_GLOBAL_STORAGE_ROOT"];
    const dir = await mkdtemp(path.join(tmpdir(), "liminal-apps-test-"));
    process.env["AGENT_GLOBAL_STORAGE_ROOT"] = dir;
  });

  after(async () => {
    const dir = process.env["AGENT_GLOBAL_STORAGE_ROOT"];
    if (dir) await rm(dir, { recursive: true, force: true });
    if (prevRoot === undefined) delete process.env["AGENT_GLOBAL_STORAGE_ROOT"];
    else process.env["AGENT_GLOBAL_STORAGE_ROOT"] = prevRoot;
  });

  it("upserts and removes apps", async () => {
    const built = buildAppSpecFromSpawn({
      type: "weather",
      id: "weather_test",
      props: { location: "Paris" },
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;

    await upsertApp(built.spec);
    const apps = await listApps();
    assert.equal(apps.length, 1);
    assert.equal(apps[0]!.id, "weather_test");

    await writeAppCache("weather_test", {
      fetched_at: Date.now(),
      ok: true,
      data: { conditions: "Clear" },
    });
    const cache = await readAppCache("weather_test");
    assert.equal(cache?.ok, true);

    const got = await getApp("weather_test");
    assert.ok(got);

    assert.equal(await removeApp("weather_test"), true);
    assert.equal((await listApps()).length, 0);
  });
});
