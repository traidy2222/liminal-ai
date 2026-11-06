import test from "node:test";
import assert from "node:assert/strict";
import { AgentHarness } from "./agent.js";
import { createDefaultExecutionState } from "./execution_state.js";

Object.assign(process.env, {
  AGENT_TRAJECTORY_WRITE: "0",
  AGENT_AUTO_DREAM: "0",
  AGENT_MEMORY_AUTO_EXTRACT: "0",
  AGENT_MEMORY_EPISODE: "0",
  AGENT_OUTCOME_JUDGE: "0",
});

function fixture() {
  const harness = new AgentHarness({
    openRouterApiKey: "offline-unused",
    baseURL: "http://127.0.0.1:1",
    model: "offline",
    worldContext: { disabled: true },
    proceduralMemory: { enabled: false },
    maxToolRoundsPerTurn: 4,
    context: {
      inceptionMessages: [
        {
          role: "system",
          content:
            "Observe fixture values and report incomplete work honestly.",
        },
      ],
      modelMaxTokens: 100000,
      thresholdFraction: 0.9,
    },
  });
  let effects = 0;
  harness.registry.register({
    name: "probe",
    description: "Observe one fixture value",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: { step: { type: "integer" } },
      required: ["step"],
    },
    handler: async () => {
      effects++;
      return { ok: true, output: "Observed fixture value" };
    },
  });
  (harness as any).toolsUsedThisTurn = ["probe"];
  return { harness, effects: () => effects };
}

test("round cap produces one tool-free grounded handoff", async () => {
  const { harness, effects } = fixture();
  const requests: number[] = [],
    heartbeats: number[] = [],
    drifts: unknown[] = [];
  let text = "",
    termination = "";
  harness.emitter.on("text", (e) => {
    if (e.channel !== "trace" && e.channel !== "reasoning") text += e.delta;
  });
  harness.emitter.on("turn_end", (e) => {
    termination = e.harnessMetrics?.terminationReason ?? "";
  });
  harness.emitter.on("drift_detected", (e) => drifts.push(e));
  harness.emitter.on("runtime_heartbeat", (e) => heartbeats.push(e.driftScore));
  (harness as any).streamWithRetry = async (
    _messages: unknown,
    tools: unknown[],
  ) => {
    requests.push(tools.length);
    return (async function* () {
      yield {
        choices: [
          {
            index: 0,
            delta: {
              content:
                "The observed value was read. Other requested work remains incomplete.",
            },
            finish_reason: "stop",
          },
        ],
      };
    })();
  };
  await (harness as any).runReActLoop(4);
  assert.deepEqual(requests, [0]);
  assert.equal(effects(), 0);
  assert.match(text, /remains incomplete/);
  assert.equal(termination, "round_cap");
  assert.equal(drifts.length, 0);
  assert(heartbeats.every((score) => score === 0));
});

test("a successful fourth round does not manufacture drift or replace the plan", async () => {
  const { harness } = fixture();
  const state = createDefaultExecutionState("Observe fixture values");
  (harness as any).executionState = state;
  (harness as any).lastUserMessage = "Observe fixture values";
  const scores: number[] = [],
    drifts: unknown[] = [];
  harness.emitter.on("runtime_heartbeat", (e) => scores.push(e.driftScore));
  harness.emitter.on("drift_detected", (e) => drifts.push(e));
  (harness as any).streamWithRetry = async () =>
    (async function* () {
      yield {
        choices: [
          {
            index: 0,
            delta: {
              content:
                "The observed values are available; no edits were requested.",
            },
            finish_reason: "stop",
          },
        ],
      };
    })();
  await (harness as any).runReActLoop(3);
  assert.deepEqual(scores, [0]);
  assert.equal(drifts.length, 0);
  assert.equal((harness as any).executionState.driftScore, 0);
  assert.deepEqual(
    (harness as any).executionState.milestones,
    state.milestones,
  );
});

test("a hallucinated tool in the budget handoff is never executed", async () => {
  const { harness, effects } = fixture();
  let text = "";
  harness.emitter.on("text", (e) => {
    if (e.channel === "user") text += e.delta;
  });
  (harness as any).streamWithRetry = async () =>
    (async function* () {
      yield {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "forbidden",
                  type: "function",
                  function: { name: "probe", arguments: '{"step":5}' },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
    })();
  await (harness as any).runReActLoop(4);
  assert.equal(effects(), 0);
  assert.match(text, /limit was reached/);
});
