import { strict as assert } from "node:assert";
import { describe, it, beforeEach, afterEach } from "node:test";
import {
  applyPromptCacheBreakpoints,
  extractCachedTokens,
  isPromptCacheEnabled,
} from "./prompt_cache.js";
import type { Message } from "./types.js";

// The helper reads AGENT_PROMPT_CACHE via effectiveHarnessEnvRaw, which falls
// back to HARNESS_ENV_DEFAULTS (default "1"). Tests below force the env var
// explicitly to lock the behavior under test.

const ORIGINAL = process.env.AGENT_PROMPT_CACHE;
const ORIGINAL_ROLLING = process.env.AGENT_PROMPT_CACHE_ROLLING;

function setEnabled(enabled: boolean) {
  process.env.AGENT_PROMPT_CACHE = enabled ? "1" : "0";
}

function setRolling(enabled: boolean) {
  process.env.AGENT_PROMPT_CACHE_ROLLING = enabled ? "1" : "0";
}

function restore() {
  if (ORIGINAL === undefined) delete process.env.AGENT_PROMPT_CACHE;
  else process.env.AGENT_PROMPT_CACHE = ORIGINAL;
  if (ORIGINAL_ROLLING === undefined) delete process.env.AGENT_PROMPT_CACHE_ROLLING;
  else process.env.AGENT_PROMPT_CACHE_ROLLING = ORIGINAL_ROLLING;
}

// The prefix-only tests below pin the rolling breakpoint OFF so they assert the
// static-prefix behavior in isolation. Rolling behavior is covered separately.
describe("applyPromptCacheBreakpoints", () => {
  beforeEach(() => {
    setEnabled(true);
    setRolling(false);
  });
  afterEach(() => restore());

  it("wraps the trailing static system message with cache_control", () => {
    const messages: Message[] = [
      { role: "system", content: "persona block" },
      { role: "system", content: "PROTOCOL_CORE + named rules + dyn suffix" },
      { role: "user", content: "hello" },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    assert.notEqual(out, messages, "should return a new array, not mutate input");
    assert.equal(messages[0]?.content, "persona block", "input unmodified");

    const target = out[1] as unknown as {
      role: string;
      content: Array<{ type: string; text: string; cache_control?: { type: string } }>;
    };
    assert.equal(target.role, "system");
    assert.ok(Array.isArray(target.content), "content widened to parts array");
    assert.equal(target.content[0]?.type, "text");
    assert.equal(target.content[0]?.text, "PROTOCOL_CORE + named rules + dyn suffix");
    assert.deepEqual(target.content[0]?.cache_control, { type: "ephemeral" });
  });

  it("includes [SUBTASK CONTEXT] prelude user messages in the static block", () => {
    const messages: Message[] = [
      { role: "system", content: "persona" },
      { role: "system", content: "core" },
      { role: "user", content: "[SUBTASK CONTEXT] do the thing" },
      { role: "user", content: "actual task" },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    // Breakpoint should land on the [SUBTASK CONTEXT] message (index 2),
    // not the bare "core" system message (index 1).
    const target = out[2] as unknown as {
      content: Array<{ cache_control?: { type: string } }>;
    };
    assert.ok(Array.isArray(target.content));
    assert.deepEqual(target.content[0]?.cache_control, { type: "ephemeral" });

    // Index 1 should remain a string.
    assert.equal(typeof (out[1] as Message).content, "string");
  });

  it("does not touch non-system/non-prelude messages", () => {
    const messages: Message[] = [
      { role: "system", content: "core" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "follow up" },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    // Only index 0 should be wrapped.
    assert.notEqual(typeof (out[0] as Message).content, "string");
    assert.equal(typeof (out[1] as Message).content, "string");
    assert.equal(typeof (out[2] as Message).content, "string");
    assert.equal(typeof (out[3] as Message).content, "string");
  });

  it("returns input unchanged when caching is disabled", () => {
    setEnabled(false);
    const messages: Message[] = [
      { role: "system", content: "core" },
      { role: "user", content: "hi" },
    ];
    const out = applyPromptCacheBreakpoints(messages);
    assert.equal(out, messages, "same reference returned");
    assert.equal(typeof (out[0] as Message).content, "string");
  });

  it("returns input unchanged for empty arrays", () => {
    const out = applyPromptCacheBreakpoints([]);
    assert.deepEqual(out, []);
  });

  it("skips messages with empty string content", () => {
    const messages: Message[] = [{ role: "system", content: "" }];
    const out = applyPromptCacheBreakpoints(messages);
    assert.equal(typeof (out[0] as Message).content, "string");
  });
});

describe("applyPromptCacheBreakpoints — rolling history breakpoint", () => {
  beforeEach(() => {
    setEnabled(true);
    setRolling(true);
  });
  afterEach(() => restore());

  const isWrapped = (m: Message | undefined): boolean =>
    !!m && Array.isArray((m as unknown as { content: unknown }).content);

  it("adds a second breakpoint on the last conversation message", () => {
    const messages: Message[] = [
      { role: "system", content: "core" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "follow up" },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    // Prefix breakpoint (index 0) + rolling breakpoint (index 3, last message).
    assert.ok(isWrapped(out[0]), "static prefix wrapped");
    assert.equal(typeof (out[1] as Message).content, "string", "middle untouched");
    assert.equal(typeof (out[2] as Message).content, "string", "middle untouched");
    assert.ok(isWrapped(out[3]), "last conversation message wrapped");
  });

  it("places the rolling breakpoint before the volatile working/exec-state tail", () => {
    const messages: Message[] = [
      { role: "system", content: "core" },
      { role: "user", content: "task" },
      { role: "tool", tool_call_id: "call_1", content: "tool result body" },
      { role: "system", content: "[WORKING STATE — bounded task snapshot]\n..." },
      { role: "system", content: "[EXECUTION STATE — contract budgets]\n..." },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    assert.ok(isWrapped(out[0]), "static prefix wrapped");
    // Rolling breakpoint lands on the last stable msg (the tool result), NOT
    // the volatile WORKING/EXECUTION-STATE blocks that change every round.
    assert.ok(isWrapped(out[2]), "last stable (tool) message wrapped");
    assert.equal(typeof (out[3] as Message).content, "string", "WORKING STATE left as string");
    assert.equal(typeof (out[4] as Message).content, "string", "EXECUTION STATE left as string");
  });

  it("does not add a second breakpoint when only the static prefix exists", () => {
    const messages: Message[] = [
      { role: "system", content: "persona" },
      { role: "system", content: "core" },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    // Only the trailing static system message (index 1) is wrapped; there is no
    // distinct conversation message to carry a second breakpoint.
    assert.equal(typeof (out[0] as Message).content, "string");
    assert.ok(isWrapped(out[1]), "static prefix wrapped");
  });

  it("can be disabled independently via AGENT_PROMPT_CACHE_ROLLING=0", () => {
    setRolling(false);
    const messages: Message[] = [
      { role: "system", content: "core" },
      { role: "user", content: "hi" },
      { role: "user", content: "follow up" },
    ];

    const out = applyPromptCacheBreakpoints(messages);

    assert.ok(isWrapped(out[0]), "static prefix still wrapped");
    assert.equal(typeof (out[2] as Message).content, "string", "no rolling breakpoint");
  });
});

describe("extractCachedTokens", () => {
  it("returns 0 for null/undefined/non-object", () => {
    assert.equal(extractCachedTokens(null), 0);
    assert.equal(extractCachedTokens(undefined), 0);
    assert.equal(extractCachedTokens("not an object"), 0);
  });

  it("reads OpenRouter-shaped prompt_tokens_details.cached_tokens", () => {
    assert.equal(
      extractCachedTokens({ prompt_tokens_details: { cached_tokens: 1234 } }),
      1234
    );
  });

  it("falls back to flat cached_tokens", () => {
    assert.equal(extractCachedTokens({ cached_tokens: 999 }), 999);
  });

  it("falls back to Anthropic-shaped cache_read_input_tokens", () => {
    assert.equal(extractCachedTokens({ cache_read_input_tokens: 500 }), 500);
  });

  it("returns 0 when the field is non-numeric", () => {
    assert.equal(
      extractCachedTokens({ prompt_tokens_details: { cached_tokens: "nope" } }),
      0
    );
  });
});

describe("isPromptCacheEnabled", () => {
  afterEach(() => restore());

  it("defaults to true when env unset", () => {
    delete process.env.AGENT_PROMPT_CACHE;
    assert.equal(isPromptCacheEnabled(), true);
  });

  it("respects explicit 0", () => {
    process.env.AGENT_PROMPT_CACHE = "0";
    assert.equal(isPromptCacheEnabled(), false);
  });

  it("respects explicit false", () => {
    process.env.AGENT_PROMPT_CACHE = "false";
    assert.equal(isPromptCacheEnabled(), false);
  });

  it("treats other values as enabled", () => {
    process.env.AGENT_PROMPT_CACHE = "1";
    assert.equal(isPromptCacheEnabled(), true);
  });
});
