import test from "node:test";
import assert from "node:assert/strict";
import type OpenAI from "openai";
import { SafetyJudge } from "./safety_judge.js";

test("heuristic allowlist: git status — no LLM call", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          return { choices: [{ message: { content: "0" } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model" });
  const r = await j.classify("run_shell", { command: "git status" });
  assert.equal(r.verdict, "safe");
  assert.equal(r.source, "heuristic");
  assert.equal(calls, 0);
});

test("heuristic: rm -rf / — require_human without LLM", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          return { choices: [{ message: { content: "0" } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model" });
  const r = await j.classify("run_shell", { command: "rm -rf /" });
  assert.equal(r.verdict, "require_human");
  assert.equal(r.source, "heuristic");
  assert.equal(calls, 0);
});

test("LLM returns 1 — require_human", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          return { choices: [{ message: { content: "1" } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model" });
  const r = await j.classify("run_shell", { command: "npm run build" });
  assert.equal(r.verdict, "require_human");
  assert.equal(r.source, "llm");
  assert.equal(calls, 1);
});

test("LLM returns 0 — safe", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          return { choices: [{ message: { content: "0" } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model" });
  const r = await j.classify("run_shell", { command: "npm run build" });
  assert.equal(r.verdict, "safe");
  assert.equal(r.source, "llm");
  assert.equal(calls, 1);
});

test("LLM abort — fail closed (require_human)", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async (
          _params: unknown,
          opts?: { signal?: AbortSignal }
        ) => {
          calls++;
          await new Promise<void>((_, reject) => {
            const sig = opts?.signal;
            if (!sig) {
              reject(new Error("no signal"));
              return;
            }
            if (sig.aborted) {
              reject(new Error("aborted"));
              return;
            }
            sig.addEventListener("abort", () => reject(new Error("aborted")), {
              once: true,
            });
          });
          return { choices: [{ message: { content: "0" } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model", timeoutMs: 30 });
  const r = await j.classify("run_shell", { command: "npm run build" });
  assert.equal(r.verdict, "require_human");
  assert.equal(r.source, "llm");
  assert.equal(calls, 1);
});

test("cache: second identical call does not invoke LLM", async () => {
  let calls = 0;
  const client = {
    chat: {
      completions: {
        create: async () => {
          calls++;
          return { choices: [{ message: { content: "0" } }] };
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, {
    model: "test-model",
    cacheTtlMs: 60_000,
  });
  const args = { command: "npm run xyz" };
  const a = await j.classify("run_shell", args);
  const b = await j.classify("run_shell", args);
  assert.equal(a.verdict, "safe");
  assert.equal(a.source, "llm");
  assert.equal(b.verdict, "safe");
  assert.equal(b.source, "cache");
  assert.equal(calls, 1);
});

test("unparseable LLM output — require_human", async () => {
  const client = {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content: "maybe" } }],
        }),
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model" });
  const r = await j.classify("run_shell", { command: "npm run build" });
  assert.equal(r.verdict, "require_human");
  assert.equal(r.source, "llm");
});

test("failOpen: LLM error yields safe", async () => {
  const client = {
    chat: {
      completions: {
        create: async () => {
          throw new Error("network");
        },
      },
    },
  } as unknown as OpenAI;
  const j = new SafetyJudge(client, { model: "test-model", failOpen: true });
  const r = await j.classify("run_shell", { command: "npm run build" });
  assert.equal(r.verdict, "safe");
  assert.equal(r.source, "llm");
});
