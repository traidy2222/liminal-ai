import test from "node:test";
import assert from "node:assert/strict";
import { parseOpenRouterSettingsCatalog, fetchOpenRouterSettingsCatalog } from "./openrouter_catalog.js";
const body = { data: [
  { id: "vendor/one", name: "One", context_length: 128000, supported_parameters: ["tools"], architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] } },
  { id: "openrouter/free", name: "Free router" }, { id: "vendor/plain" }, { id: "" }, null,
] };
test("catalog retains individual models and capability metadata, identifies routers", () => {
  const rows = parseOpenRouterSettingsCatalog(body);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(r => r.id === "vendor/one")?.supportsTools, true);
  assert.equal(rows.find(r => r.id === "vendor/one")?.contextLength, 128000);
  assert.equal(rows.find(r => r.id === "openrouter/free")?.isRouter, true);
  assert.throws(() => parseOpenRouterSettingsCatalog({}), /invalid/);
});
test("catalog coalesces requests, caches, and reports refresh failures without forwarding credentials", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url, init) => {
    calls++;
    assert.equal(url, "https://openrouter.ai/api/v1/models");
    assert.equal(new Headers(init?.headers).has("Authorization"), false);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const [a, b] = await Promise.all([fetchOpenRouterSettingsCatalog(true), fetchOpenRouterSettingsCatalog(true)]);
    assert.deepEqual(a, b); assert.equal(calls, 1);
    await fetchOpenRouterSettingsCatalog(); assert.equal(calls, 1);
    globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
    await assert.rejects(fetchOpenRouterSettingsCatalog(true), /503/);
  } finally { globalThis.fetch = original; }
});
