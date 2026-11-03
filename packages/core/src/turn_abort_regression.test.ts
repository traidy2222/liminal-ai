import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentHarness } from "./agent.js";

const PARTIAL = "Observed the archive header; extraction is still incomplete.";

async function fixture(t: TestContext) {
  const previous = { ...process.env };
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-turn-abort-"));
  Object.assign(process.env, {
    AGENT_GLOBAL_STORAGE_ROOT: root,
    AGENT_WORKSPACE_ROOT: root,
    AGENT_INFERENCE_MODE: "byok",
    AGENT_API_KEY: "synthetic-test-key",
    AGENT_INTENT_INFERENCE: "0",
    AGENT_INTENT_ROUTING: "0",
    AGENT_MEMORY_PRIME_ROUND0: "0",
    AGENT_RECALL_EVERY_N: "0",
    AGENT_RULE_RECALL: "0",
    AGENT_TRAJECTORY_WRITE: "0",
    AGENT_MEMORY_AUTO_EXTRACT: "0",
    AGENT_MEMORY_EPISODE: "0",
    AGENT_AUTO_DREAM: "0",
    AGENT_VAULT_AUTO_WRITE: "0",
    AGENT_CRITIC: "0",
    AGENT_EFFORT_LEARN: "0",
    AGENT_YIELD_EVERY_N: "0",
    AGENT_HEARTBEAT: "0",
    AGENT_PASTE: "0",
    AGENT_SEND_TIMEOUT_MS: "0",
  });
  const harness = new AgentHarness({
    openRouterApiKey: "synthetic-test-key",
    baseURL: "http://127.0.0.1:1",
    model: "fixture",
    workspaceRoot: root,
    maxToolRoundsPerTurn: 4,
    maxRetries: 0,
    maxRateLimitRetries: 0,
    maxTransient5xxRetries: 0,
    worldContext: { disabled: true },
    context: {
      inceptionMessages: [],
      modelMaxTokens: 1000000,
      thresholdFraction: 0.9,
    },
  });
  const agent = harness as any;
  // Use the real public send/stop lifecycle and real ReAct loop, while excluding
  // unrelated background/provider work. The fake stream never calls a provider.
  agent.prepareMessagesForContextLimit = async (messages: unknown) => messages;
  agent.maybeRecoverManagedInferenceRoute = async () => {};
  agent.maybePreemptManagedCreditExhaustion = async () => {};
  agent.refreshManagedInferenceCatalog = async () => {};
  agent.persistEpisodicRecipeAfterTurn = async () => {};
  agent.queueOrRecordTurnLearning = () => {};
  agent.maybePersistEpisodeTurn = async () => {};
  agent.maybeAutoWriteVaultNotes = async () => {};
  agent.maybeAutoExtractMemories = async () => {};
  agent.triggerAutoDreamConsolidationBackground = () => {};
  agent.triggerVaultCurateBackground = () => {};
  const summaries: any[] = [],
    ends: any[] = [];
  let visible = "";
  harness.emitter.on("turn_summary", (payload) => summaries.push(payload));
  harness.emitter.on("turn_end", (payload) => ends.push(payload));
  harness.emitter.on("text", (payload) => {
    if (!payload.channel || payload.channel === "user")
      visible += payload.delta;
  });
  t.after(async () => {
    process.env = previous;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-turn-abort-"));
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 20,
    });
  });
  function assertStopped(priorText?: string) {
    assert.equal(
      ends.length,
      1,
      "stopping a send must emit exactly one turn_end",
    );
    assert(
      ["aborted", "error"].includes(ends[0]?.harnessMetrics?.terminationReason),
      "a stopped turn must not report successful completion",
    );
    assert(
      !summaries.some((summary) => summary.terminationReason === "ok"),
      "a stopped turn must not emit a success summary",
    );
    assert.match(
      visible,
      /stopp|abort|cancel/i,
      "the user needs a visible stopped-work handoff",
    );
    assert.match(visible, /incomplete|not complete|remaining|pending/i);
    const persisted = harness
      .getContext()
      .getConversationMessages()
      .filter((message) => message.role === "assistant")
      .map((message) =>
        typeof message.content === "string" ? message.content : "",
      )
      .join("\n");
    assert.match(
      persisted,
      /stopp|abort|cancel/i,
      "the handoff must survive reopening/resume",
    );
    if (priorText) {
      assert(
        visible.includes(priorText),
        "stopping must retain already-streamed text",
      );
      assert(
        persisted.includes(priorText),
        "partial narration must also remain in context",
      );
    }
    assert.equal(harness.getIsRunning(), false);
  }
  return { harness, agent, assertStopped };
}

function textChunk(content: string) {
  return { choices: [{ index: 0, delta: { content }, finish_reason: "stop" }] };
}

test(
  "public stop after partial text handles an SDK stream ending normally, without reporting success",
  { timeout: 10000 },
  async (t) => {
    const { harness, agent, assertStopped } = await fixture(t);
    let streams = 0;
    agent.streamWithRetry = async () =>
      (async function* () {
        streams++;
        yield textChunk(PARTIAL);
        harness.abortCurrentTurn();
        // Some SDK transports end their iterator on cancellation without throwing.
        return;
      })();
    await harness.send("Summarize the observed archive header.");
    assertStopped(PARTIAL);
    assert.equal(streams, 1, "do not open a continuation after stop");
  },
);

test(
  "public stop before tool dispatch prevents the pending tool from executing",
  { timeout: 10000 },
  async (t) => {
    const { harness, agent, assertStopped } = await fixture(t);
    let executions = 0,
      streams = 0;
    harness.registry.register({
      name: "extract_fixture",
      description: "Owned extraction fixture",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async () => {
        executions++;
        return { ok: true, output: "Must not execute after stop" };
      },
    });
    harness.registry.activate(["extract_fixture"]);
    harness.emitter.on("tool_start", (payload) => {
      if (payload.name === "extract_fixture") harness.abortCurrentTurn();
    });
    agent.streamWithRetry = async () =>
      (async function* () {
        if (++streams > 1) {
          yield textChunk("No further work.");
          return;
        }
        yield {
          choices: [
            {
              index: 0,
              delta: {
                content: PARTIAL,
                tool_calls: [
                  {
                    index: 0,
                    id: "pending-extract",
                    type: "function",
                    function: { name: "extract_fixture", arguments: "{}" },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        };
      })();
    await harness.send("Inspect the selected local game archive.");
    assert.equal(
      executions,
      0,
      "a queued tool must never run after the turn is stopped",
    );
    assertStopped(PARTIAL);
    assert.equal(streams, 1);
  },
);

test(
  "public stop during turn preparation opens no completion stream",
  { timeout: 10000 },
  async (t) => {
    const { harness, agent, assertStopped } = await fixture(t);
    let streams = 0;
    harness.onTurnStartMemorySync = async () => {
      harness.abortCurrentTurn();
    };
    agent.streamWithRetry = async () =>
      (async function* () {
        streams++;
        yield textChunk("This completion must never start.");
      })();
    await harness.send("Summarize the observed archive header.");
    assert.equal(
      streams,
      0,
      "stopping preparation must prevent the provider request",
    );
    assertStopped();
  },
);

test(
  "public stop during context preparation is rechecked before opening the stream",
  { timeout: 10000 },
  async (t) => {
    const { harness, agent, assertStopped } = await fixture(t);
    let streams = 0;
    agent.prepareMessagesForContextLimit = async (messages: unknown) => {
      harness.abortCurrentTurn();
      return messages;
    };
    agent.streamWithRetry = async () =>
      (async function* () {
        streams++;
        yield textChunk("This completion must never start.");
      })();
    await harness.send("Summarize the observed archive header.");
    assert.equal(
      streams,
      0,
      "context preparation must not submit a request after stop",
    );
    assertStopped();
  },
);

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function assertToolMessagesPaired(harness: AgentHarness) {
  const messages = harness.getContext().getConversationMessages() as any[];
  for (let i = 0; i < messages.length; i++) {
    const calls =
      messages[i].role === "assistant" ? messages[i].tool_calls : undefined;
    if (!calls?.length) continue;
    const pending = new Set(calls.map((call: { id: string }) => call.id));
    let cursor = i + 1;
    while (pending.size) {
      const next = messages[cursor++];
      assert.equal(
        next?.role,
        "tool",
        "a stopped assistant tool-call message must have paired results before another user/assistant message",
      );
      assert(
        pending.delete(next.tool_call_id),
        "tool results must pair exactly once with their assistant call",
      );
    }
  }
}

function toolChunk(callId: string, toolName: string) {
  return {
    choices: [
      {
        index: 0,
        delta: {
          content: PARTIAL,
          tool_calls: [
            {
              index: 0,
              id: callId,
              type: "function",
              function: { name: toolName, arguments: "{}" },
            },
          ],
        },
        finish_reason: "tool_calls",
      },
    ],
  };
}

test(
  "a deadline aborts its captured signal and late uncancellable work cannot corrupt the next turn",
  { timeout: 10000 },
  async (t) => {
    const { harness, agent } = await fixture(t);
    process.env.AGENT_SEND_TIMEOUT_MS = "31000";
    const entered = deferred(),
      finishOld = deferred(),
      newEntered = deferred(),
      finishPreparation = deferred();
    const loops: Promise<unknown>[] = [];
    const actualLoop = agent.runReActLoop.bind(agent);
    agent.runReActLoop = (...args: unknown[]) => {
      const loop = actualLoop(...args);
      loops.push(loop);
      void loop.catch(() => {});
      return loop;
    };
    let signal: AbortSignal | undefined,
      streams = 0;
    const ends: any[] = [],
      summaries: any[] = [];
    harness.emitter.on("turn_end", (event) => ends.push(event));
    harness.emitter.on("turn_summary", (event) => summaries.push(event));
    harness.registry.register({
      name: "uncancellable_fixture",
      intentDedupArgs: ["fixture"],
      description:
        "Controlled non-cancelling fixture; no actual process or provider",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (_args, _emit, _harness, context) => {
        signal = context?.signal;
        entered.resolve();
        await finishOld.promise;
        return { ok: true, output: "LATE_OLD_FIXTURE_RESULT" };
      },
    });
    harness.registry.activate(["uncancellable_fixture"]);
    agent.streamWithRetry = async () =>
      (async function* () {
        yield ++streams === 1
          ? toolChunk("old-deadline-call", "uncancellable_fixture")
          : textChunk("The independent second turn completed.");
      })();
    t.after(async () => {
      finishOld.resolve();
      finishPreparation.resolve();
      t.mock.timers.reset();
      await Promise.allSettled(loops);
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const first = harness.send("Inspect this selected local game archive.");
    await entered.promise;
    assert(signal, "the active tool receives the turn's cancellation signal");
    const oldLoop = loops[0]!;
    t.mock.timers.tick(31001);
    await first;
    t.mock.timers.reset();
    assert.equal(
      signal.aborted,
      true,
      "the deadline must abort the captured signal even if the tool ignores it",
    );
    assert.equal(ends.length, 1);
    assert.equal(ends[0].harnessMetrics.terminationReason, "timeout");
    assert.equal(
      summaries.filter((event) => event.terminationReason === "ok").length,
      0,
    );

    process.env.AGENT_SEND_TIMEOUT_MS = "0";
    harness.onTurnStartMemorySync = async () => {
      newEntered.resolve();
      await finishPreparation.promise;
    };
    const second = harness.send("Summarize an independent second task.");
    void second.catch(() => {});
    await newEntered.promise;
    const beforeLateCompletion = JSON.stringify(
      harness.getContext().getConversationMessages(),
    );
    const beforeLateIntents = JSON.stringify([...agent.intentResultsThisSend]);
    let lateDagClears = 0;
    t.mock.method(agent._toolDag, "clear", () => { lateDagClears++; });
    finishOld.resolve();
    await Promise.allSettled([oldLoop]);
    assert(
      JSON.stringify(harness.getContext().getConversationMessages()) ===
        beforeLateCompletion,
      "an old timed-out tool must not append results or mutate the new turn's context",
    );
    assert.equal(JSON.stringify([...agent.intentResultsThisSend]), beforeLateIntents, "old results must not poison the new turn's intent cache");
    assert.equal(lateDagClears, 0, "an old batch must not clear the new turn's dependency graph");
    assert.equal(
      ends.length,
      1,
      "the abandoned loop must not finish or clear busy for the new turn",
    );
    assert.equal(
      summaries.filter((event) => event.terminationReason === "ok").length,
      0,
      "late old work must not produce a success summary",
    );
    assertToolMessagesPaired(harness);

    finishPreparation.resolve();
    await second;
    assert.equal(ends.length, 2);
    assert.equal(ends[1].harnessMetrics.terminationReason, "ok");
    assert.equal(
      summaries.filter((event) => event.terminationReason === "ok").length,
      1,
    );
    assert.equal(
      streams,
      2,
      "only the first and explicitly requested second completion may run",
    );
    assertToolMessagesPaired(harness);
  },
);

test(
  "direct stop while a nonthrowing tool settles preserves pairing without another completion",
  { timeout: 10000 },
  async (t) => {
    const { harness, agent, assertStopped } = await fixture(t);
    const entered = deferred(),
      finish = deferred();
    let signal: AbortSignal | undefined,
      streams = 0;
    harness.registry.register({
      name: "settling_fixture",
      description: "Controlled nonthrowing active tool",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      requiresApproval: false,
      handler: async (_args, _emit, _harness, context) => {
        signal = context?.signal;
        entered.resolve();
        await finish.promise;
        return {
          ok: true,
          output: "The physical fixture completed after stop.",
        };
      },
    });
    harness.registry.activate(["settling_fixture"]);
    agent.streamWithRetry = async () =>
      (async function* () {
        yield ++streams === 1
          ? toolChunk("active-stop-call", "settling_fixture")
          : textChunk("A forbidden continuation.");
      })();
    const sending = harness.send("Inspect this selected local game archive.");
    t.after(async () => {
      finish.resolve();
      await sending;
    });
    await entered.promise;
    harness.abortCurrentTurn();
    assert.equal(signal?.aborted, true);
    finish.resolve();
    await sending;
    assertStopped(PARTIAL);
    assert.equal(
      streams,
      1,
      "a stopped active tool must not start a continuation completion",
    );
    assertToolMessagesPaired(harness);
  },
);
