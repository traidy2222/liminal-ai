import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ChatAutoTitler } from "./chat_auto_title.js";
import { createChatMetadata, readChatMetadata, touchChatMetadata, updateChatMetadata } from "./chat_metadata.js";
import type { Message } from "./types.js";
import { readCacheStats } from "./cache_telemetry.js";

test("title requests report their real usage separately without storing conversation text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-title-usage-"));
  const before = { ...process.env }, originalFetch = globalThis.fetch;
  try {
    process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
    process.env.AGENT_CHAT_AUTO_TITLE = "1";
    process.env.AGENT_CHAT_TITLE_MODEL = "fixture/title";
    globalThis.fetch = async () => new Response(JSON.stringify({
      id: "title-fixture", provider: "Fixture", choices: [{ message: { content: '{"title":"Browser isolation"}' } }],
      usage: { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 60 }, completion_tokens: 6, cost: 0.000001 },
    }), { headers: { "Content-Type": "application/json" } });
    await createChatMetadata({ chatId: "title-usage", workspaceMode: "folder", workspaceRoot: root });
    const result = await new ChatAutoTitler().recordTurn("title-usage", [
      { role: "user", content: "private fixture conversation" },
    ], { baseURL: "https://openrouter.ai/api/v1", apiKey: "fixture-only" });
    assert.equal(result?.title, "Browser isolation");
    const stats = await readCacheStats("title-usage");
    assert.equal(stats.byScope.title?.inputTokens, 100);
    assert.equal(stats.byScope.title?.cachedTokens, 60);
    assert.equal(stats.byScope.title?.reportedCostUsd, 0.000001);
    assert.equal(stats.agent.requests, 0);
    assert.doesNotMatch(await fs.readFile(path.join(root, "cache_usage.jsonl"), "utf8"), /private fixture|fixture-only/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env = before;
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("background chat titles are bounded, throttled, persistent and preserve user ownership", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-chat-title-"));
  const previous = process.env.AGENT_GLOBAL_STORAGE_ROOT;
  const previousEnabled = process.env.AGENT_CHAT_AUTO_TITLE;
  process.env.AGENT_GLOBAL_STORAGE_ROOT = root;
  process.env.AGENT_CHAT_AUTO_TITLE = "1";
  const provider = { baseURL: "https://openrouter.ai/api/v1", apiKey: "fixture-only" };
  const messages = (content = "Fix browser tab isolation"): Message[] => [{ role: "user", content }, { role: "assistant", content: "Implemented chat-owned browser tabs." }];
  const create = (chatId: string, title?: string) => createChatMetadata({ chatId, title, workspaceMode: "folder", workspaceRoot: root });
  try {
    await t.test("initial title and topic changes use only a small redacted excerpt at bounded intervals", async () => {
      await create("automatic"); let now = 1000000; const requests: any[] = [];
      const titler = new ChatAutoTitler(async request => { requests.push(request); return requests.length === 1 ? "Browser tab isolation" : "Background chat titling"; }, () => now);
      const first = await titler.recordTurn("automatic", messages("Fix browser tabs. api_key=sk-or-v1-" + "a".repeat(40) + " ```secret code``` " + "long ".repeat(500)), provider);
      assert.equal(first?.title, "Browser tab isolation");
      assert.equal((await readChatMetadata("automatic"))?.titleSource, "auto");
      assert.equal(requests[0].model, "inclusionai/ling-3.0-tiny");
      assert.doesNotMatch(JSON.stringify(requests), /sk-or-v1|secret code/);
      assert.ok(requests[0].excerpt.every((m: any) => m.content.length <= 700));
      for (let i = 0; i < 3; i++) await titler.recordTurn("automatic", messages("Now implement dynamic chat titles"), provider);
      assert.equal(requests.length, 1);
      now += 180001;
      const second = await titler.recordTurn("automatic", messages("Now implement dynamic chat titles"), provider);
      assert.equal(requests.length, 2); assert.equal(second?.title, "Background chat titling");
      assert.ok(requests[1].excerpt.length <= 8);
      const restarted = new ChatAutoTitler(async () => { throw Error("must remain throttled after restart"); }, () => now);
      assert.equal(await restarted.recordTurn("automatic", messages(), provider), null);
    });
    await t.test("manual names and manual edits during a pending request win", async () => {
      await create("manual", "My release roadmap"); let calls = 0;
      const titler = new ChatAutoTitler(async () => { calls++; return "Unwanted title"; });
      assert.equal(await titler.recordTurn("manual", messages(), provider), null); assert.equal(calls, 0);
      await create("pending");
      let finish!: (title: string) => void; let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const delayed = new ChatAutoTitler(() => { started(); return new Promise(resolve => { finish = resolve; }); });
      const pending = delayed.recordTurn("pending", messages(), provider); await ready;
      await updateChatMetadata("pending", meta => ({ ...meta, title: "My chosen title", titleSource: "manual" }));
      await touchChatMetadata("pending"); finish("Late generated title"); await pending;
      assert.equal((await readChatMetadata("pending"))?.title, "My chosen title");
    });
    await t.test("failures back off and disabled or non-OpenRouter providers make no requests", async () => {
      await create("failure"); let now = 1000000; let calls = 0;
      const titler = new ChatAutoTitler(async () => { calls++; throw Error("provider unavailable"); }, () => now);
      await titler.recordTurn("failure", messages(), provider);
      now += 180001; await titler.recordTurn("failure", messages(), provider); assert.equal(calls, 1);
      now += 900001; await titler.recordTurn("failure", messages(), provider); assert.equal(calls, 2);
      process.env.AGENT_CHAT_AUTO_TITLE = "0";
      await titler.recordTurn("failure", messages(), provider); assert.equal(calls, 2);
      process.env.AGENT_CHAT_AUTO_TITLE = "1";
      await titler.recordTurn("failure", messages(), { ...provider, baseURL: "http://localhost:1234/v1" }); assert.equal(calls, 2);
    });
    await t.test("a deleted chat is not resurrected by a late title", async () => {
      await create("deleted"); let finish!: (title: string) => void; let started!: () => void;
      const ready = new Promise<void>(resolve => { started = resolve; });
      const titler = new ChatAutoTitler(() => { started(); return new Promise(resolve => { finish = resolve; }); });
      const pending = titler.recordTurn("deleted", messages(), provider); await ready;
      const directory = path.resolve(root, "chats", "deleted");
      assert.ok(directory.startsWith(root + path.sep));
      await fs.rm(directory, { recursive: true, force: true });
      finish("Late title"); await pending;
      assert.equal(await readChatMetadata("deleted"), null);
      await assert.rejects(fs.access(directory));
    });
  } finally {
    if (previous === undefined) delete process.env.AGENT_GLOBAL_STORAGE_ROOT; else process.env.AGENT_GLOBAL_STORAGE_ROOT = previous;
    if (previousEnabled === undefined) delete process.env.AGENT_CHAT_AUTO_TITLE; else process.env.AGENT_CHAT_AUTO_TITLE = previousEnabled;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    await fs.rm(root, { recursive: true, force: true });
  }
});
