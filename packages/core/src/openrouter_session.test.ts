import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOpenRouterSessionExtras,
  isOpenRouterApiBaseUrl,
  normalizeOpenRouterSessionId,
  openRouterSessionsEnabled,
} from "./openrouter_session.js";
import { runWithChatId } from "./chat_context.js";

test("isOpenRouterApiBaseUrl detects OpenRouter hosts", () => {
  assert.equal(isOpenRouterApiBaseUrl("https://openrouter.ai/api/v1"), true);
  assert.equal(isOpenRouterApiBaseUrl("https://api.openai.com/v1"), false);
});

test("normalizeOpenRouterSessionId clamps length", () => {
  const long = "a".repeat(300);
  assert.equal(normalizeOpenRouterSessionId(long).length, 256);
});

test("buildOpenRouterSessionExtras includes session_id on OpenRouter", () => {
  const prev = process.env.AGENT_OPENROUTER_SESSIONS;
  process.env.AGENT_OPENROUTER_SESSIONS = "1";
  try {
    const extras = buildOpenRouterSessionExtras(
      "https://openrouter.ai/api/v1",
      "my-session-123"
    );
    assert.equal(extras.session_id, "my-session-123");
    assert.equal(extras.user, "my-session-123");
  } finally {
    if (prev === undefined) delete process.env.AGENT_OPENROUTER_SESSIONS;
    else process.env.AGENT_OPENROUTER_SESSIONS = prev;
  }
});

test("buildOpenRouterSessionExtras is empty when disabled", () => {
  const prev = process.env.AGENT_OPENROUTER_SESSIONS;
  process.env.AGENT_OPENROUTER_SESSIONS = "0";
  try {
    assert.deepEqual(
      buildOpenRouterSessionExtras("https://openrouter.ai/api/v1", "x"),
      {}
    );
  } finally {
    if (prev === undefined) delete process.env.AGENT_OPENROUTER_SESSIONS;
    else process.env.AGENT_OPENROUTER_SESSIONS = prev;
  }
});

test("resolveOpenRouterSessionId uses active chat id from AsyncLocalStorage", () => {
  const prev = process.env.AGENT_OPENROUTER_SESSIONS;
  process.env.AGENT_OPENROUTER_SESSIONS = "1";
  delete process.env.AGENT_OPENROUTER_SESSION_ID;
  try {
    runWithChatId("chat-abc-99", () => {
      const extras = buildOpenRouterSessionExtras("https://openrouter.ai/api/v1");
      assert.equal(extras.session_id, "chat-abc-99");
    });
  } finally {
    if (prev === undefined) delete process.env.AGENT_OPENROUTER_SESSIONS;
    else process.env.AGENT_OPENROUTER_SESSIONS = prev;
  }
});

test("openRouterSessionsEnabled defaults on", () => {
  const prev = process.env.AGENT_OPENROUTER_SESSIONS;
  delete process.env.AGENT_OPENROUTER_SESSIONS;
  try {
    assert.equal(openRouterSessionsEnabled(), true);
  } finally {
    if (prev === undefined) delete process.env.AGENT_OPENROUTER_SESSIONS;
    else process.env.AGENT_OPENROUTER_SESSIONS = prev;
  }
});
