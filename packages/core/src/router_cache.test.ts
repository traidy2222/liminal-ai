import test from "node:test";
import assert from "node:assert/strict";
import { completeChatJson, clearJsonResponseCache } from "./router.js";

/** Minimal stub shaped like the bits of the OpenAI client router.ts touches. */
function makeStubClient(payload: string): { client: any; calls: () => number } {
  let calls = 0;
  const client = {
    apiKey: "test-key",
    baseURL: "https://example.test/v1",
    chat: {
      completions: {
        create: async () => {
          calls += 1;
          return { choices: [{ message: { content: payload } }] };
        },
      },
    },
  };
  return { client, calls: () => calls };
}

const baseOpts = {
  model: "test/model",
  messages: [
    { role: "system" as const, content: "sys" },
    { role: "user" as const, content: "classify this" },
  ],
  maxTokens: 100,
  temperature: 0.2,
};

test("completeChatJson caches identical successful calls (one network hit)", async () => {
  process.env.AGENT_LLM_JSON_CACHE = "1";
  clearJsonResponseCache();
  const { client, calls } = makeStubClient('{"intent":"knowledge"}');

  const first = await completeChatJson(client, baseOpts);
  const second = await completeChatJson(client, baseOpts);

  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.deepEqual((second as { parsed: unknown }).parsed, { intent: "knowledge" });
  assert.equal(calls(), 1, "second identical call should be served from cache");
});

test("cache key separates different messages", async () => {
  process.env.AGENT_LLM_JSON_CACHE = "1";
  clearJsonResponseCache();
  const { client, calls } = makeStubClient('{"ok":true}');

  await completeChatJson(client, baseOpts);
  await completeChatJson(client, {
    ...baseOpts,
    messages: [{ role: "user" as const, content: "totally different prompt" }],
  });

  assert.equal(calls(), 2, "different prompts must not collide in the cache");
});

test("AGENT_LLM_JSON_CACHE=0 disables caching", async () => {
  process.env.AGENT_LLM_JSON_CACHE = "0";
  clearJsonResponseCache();
  const { client, calls } = makeStubClient('{"ok":true}');

  await completeChatJson(client, baseOpts);
  await completeChatJson(client, baseOpts);

  assert.equal(calls(), 2, "cache disabled → every call hits the network");
  process.env.AGENT_LLM_JSON_CACHE = "1";
});

test("cache: false opt bypasses the cache for a single call", async () => {
  process.env.AGENT_LLM_JSON_CACHE = "1";
  clearJsonResponseCache();
  const { client, calls } = makeStubClient('{"ok":true}');

  await completeChatJson(client, baseOpts);
  await completeChatJson(client, { ...baseOpts, cache: false });

  assert.equal(calls(), 2, "cache:false must re-fetch even on identical input");
});

test("failed (empty) completions are not cached", async () => {
  process.env.AGENT_LLM_JSON_CACHE = "1";
  clearJsonResponseCache();
  const { client, calls } = makeStubClient("   "); // blank → ok:false

  const first = await completeChatJson(client, baseOpts);
  const second = await completeChatJson(client, baseOpts);

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  assert.equal(calls(), 2, "failures must retry, never serve a cached error");
});
