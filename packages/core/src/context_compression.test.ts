import test from "node:test";
import assert from "node:assert/strict";
import type { Message } from "openai/resources/chat/completions.js";
import { ContextManager } from "./context.js";

function assistantToolRound(toolName: string, result: string, isError = false): Message[] {
  const callId = `call_${toolName}_${Math.random().toString(36).slice(2, 8)}`;
  return [
    {
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: callId,
          type: "function",
          function: { name: toolName, arguments: "{}" },
        },
      ],
    } as Message,
    {
      role: "tool",
      tool_call_id: callId,
      content: isError ? `ERROR: ${result}` : result,
    } as Message,
  ];
}

test("ContextManager compresses failed tool rounds (not left verbatim forever)", async () => {
  const prevHot = process.env.AGENT_CTX_HOT_ROUNDS;
  const prevProv = process.env.AGENT_CTX_PROVENANCE;
  process.env.AGENT_CTX_HOT_ROUNDS = "2";
  process.env.AGENT_CTX_PROVENANCE = "0";
  try {
    const cm = new ContextManager({
      modelMaxTokens: 500,
      thresholdFraction: 0.4,
      keepRecentRounds: 2,
      inceptionMessages: [{ role: "system", content: "test harness context compression" }],
    });

    for (let i = 0; i < 14; i++) {
      cm.appendMessage({ role: "user", content: `step ${i} `.repeat(24) });
      for (const m of assistantToolRound(
        "list_dir",
        `ERROR: fail round ${i} ${"payload ".repeat(40)}`,
        true
      )) {
        cm.appendMessage(m);
      }
    }

    const before = cm.buildMessagesSync();
    const beforeToolBodies = before.filter(
      (m) => m.role === "tool" && typeof m.content === "string" && m.content.includes("ERROR: fail round 0")
    );
    assert.ok(beforeToolBodies.length >= 1, "oldest error round present before compression");

    const after = await cm.buildMessages();
    const oldErrors = after.filter(
      (m) =>
        m.role === "tool" &&
        typeof m.content === "string" &&
        m.content.includes("ERROR: fail round 0")
    );
    const summaries = after.filter(
      (m) =>
        m.role === "user" &&
        typeof m.content === "string" &&
        m.content.includes("CONTEXT SUMMARY")
    );
    assert.equal(oldErrors.length, 0, "oldest error round should be compressed away");
    assert.ok(summaries.length >= 1, "compression summary should exist");
    assert.match(String(summaries[0]!.content), /FAILED ROUND/i);
  } finally {
    if (prevHot === undefined) delete process.env.AGENT_CTX_HOT_ROUNDS;
    else process.env.AGENT_CTX_HOT_ROUNDS = prevHot;
    if (prevProv === undefined) delete process.env.AGENT_CTX_PROVENANCE;
    else process.env.AGENT_CTX_PROVENANCE = prevProv;
  }
});
