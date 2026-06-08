import type { Scenario } from "../runner.js";
import { traceHasTurnEnd, traceGetSnapshot, traceGetFinalAssistantText } from "../runner.js";

const longPreamble = "context ".repeat(400);

export const contextRotLongUser: Scenario = {
  name: "context-rot-long-user",
  userMessage:
    longPreamble +
    "\n\nAfter that padding, reply with exactly one word: ROTOK.",
  maxRounds: 8,
  timeoutMs: 60_000,
  assertions: [
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "snapshot valid",
      check: (t) => {
        const s = traceGetSnapshot(t);
        return s !== null && s.tokenCount > 0 && s.usageFraction > 0;
      },
    },
    {
      name: "instruction retained (ROTOK)",
      check: (t) => {
        const text = traceGetFinalAssistantText(t) ?? "";
        return /\bROTOK\b/i.test(text);
      },
    },
  ],
};

/** Numbered constraints must survive proactive compression on a long tool-heavy turn. */
export const contextRotConstraintRetention: Scenario = {
  name: "context-rot-constraint-retention",
  env: {
    AGENT_CTX_HOT_ROUNDS: "2",
    AGENT_TOOL_BODY_ELIDE: "1",
  },
  userMessage:
    "Remember these three codes for this task only: ALPHA-7, BETA-9, GAMMA-3. " +
    "Call think once with each code name, then list_dir on packages/core/src (one level). " +
    "Then reply with exactly: CODES=ALPHA-7,BETA-9,GAMMA-3",
  maxRounds: 14,
  timeoutMs: 90_000,
  assertions: [
    { name: "turn_end", check: (t) => traceHasTurnEnd(t) },
    {
      name: "all codes in final answer",
      check: (t) => {
        const text = traceGetFinalAssistantText(t) ?? "";
        return (
          text.includes("ALPHA-7") &&
          text.includes("BETA-9") &&
          text.includes("GAMMA-3")
        );
      },
    },
    {
      name: "compression or elision observed on long turn",
      check: (t) =>
        t.some((e) => e.type === "context_compressed") ||
        t.some(
          (e) =>
            e.type === "text" &&
            typeof (e.payload as { delta?: string }).delta === "string" &&
            (e.payload as { delta: string }).delta.includes("CONTEXT SUMMARY")
        ),
    },
  ],
};

export const CONTEXT_ROT_SCENARIOS = [contextRotLongUser, contextRotConstraintRetention];
