import test from "node:test";
import assert from "node:assert/strict";
import { AgentHarness } from "./agent.js";
import { createDefaultExecutionState } from "./execution_state.js";

type Call = { name: string; args: string };
async function run(calls: Call[], register: (h: AgentHarness) => void) {
  const previous = { ...process.env };
  Object.assign(process.env, {
    AGENT_RULE_RECALL: "0",
    AGENT_TRAJECTORY_WRITE: "0",
    AGENT_CRITIC: "0",
    AGENT_YIELD_EVERY_N: "0",
    AGENT_MEMORY_PRIME_ROUND0: "0",
  });
  const h = new AgentHarness({
    openRouterApiKey: "fixture",
    baseURL: "http://127.0.0.1:1",
    model: "fixture",
    maxToolRoundsPerTurn: 40,
    worldContext: { disabled: true },
    context: {
      inceptionMessages: [],
      modelMaxTokens: 1000000,
      thresholdFraction: 0.9,
    },
  });
  const a = h as any;
  a.executionState = createDefaultExecutionState("Inspect a local artifact");
  a.sendStartTime = Date.now();
  a.lastUserMessage = "Inspect a local artifact";
  a.prepareMessagesForContextLimit = async (m: unknown) => m;
  register(h);
  let round = 0;
  a.streamWithRetry = async () =>
    (async function* () {
      const c = calls[round++];
      yield {
        choices: [
          {
            index: 0,
            delta: c
              ? {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-" + round,
                      type: "function",
                      function: { name: c.name, arguments: c.args },
                    },
                  ],
                }
              : { content: "Finished the fixture." },
            finish_reason: c ? "tool_calls" : "stop",
          },
        ],
      };
    })();
  try {
    await a.runReActLoop();
    return h
      .getContext()
      .getConversationMessages()
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
  } finally {
    process.env = previous;
  }
}
const argsA = '{"path":"archive.bin","offset":0}';
const argsB = '{ "offset": 0, "path": "archive.bin" }';
function tool(
  h: AgentHarness,
  name: string,
  handler: () => Promise<any>,
  dangerLevel?: "destructive",
) {
  h.registry.register({
    name,
    description: name,
    parameters: { type: "object", properties: {}, additionalProperties: true },
    requiresApproval: false,
    dangerLevel,
    handler,
  });
  h.registry.activate([name]);
}

test("the same failed call is bounded across reasoning and discovery with reordered JSON", async () => {
  let attempts = 0;
  const calls: Call[] = [];
  for (let i = 0; i < 4; i++) {
    calls.push({ name: "inspect_fixture", args: i % 2 ? argsB : argsA });
    if (i < 3)
      calls.push({ name: i % 2 ? "mcp_search_fixture" : "think", args: "{}" });
  }
  const context = await run(calls, (h) => {
    tool(h, "inspect_fixture", async () => {
      attempts++;
      return { ok: false, error: "Unsupported analysis provider for MIPS" };
    });
    tool(h, "think", async () => ({
      ok: true,
      output: "Considering the same target.",
    }));
    tool(h, "mcp_search_fixture", async () => ({
      ok: true,
      output: "The same tools are available.",
    }));
  });
  assert.equal(
    attempts,
    3,
    "the fourth equivalent failure must not execute again",
  );
  assert.match(context, /LOOP DETECTED/);
});

test("a successful repair allows an identical failed command to be retried", async () => {
  let repaired = false,
    attempts = 0;
  const context = await run(
    [
      { name: "read_file", args: argsA },
      { name: "think", args: "{}" },
      { name: "read_file", args: argsA },
      { name: "think", args: "{}" },
      { name: "read_file", args: argsA },
      { name: "repair_fixture", args: "{}" },
      { name: "read_file", args: argsA },
    ],
    (h) => {
      tool(h, "read_file", async () => {
        attempts++;
        return repaired
          ? { ok: true, output: "File repaired" }
          : { ok: false, error: "ENOENT: no such file" };
      });
      tool(h, "think", async () => ({
        ok: true,
        output: "Reconsider the provider.",
      }));
      tool(
        h,
        "repair_fixture",
        async () => {
          repaired = true;
          return {
            ok: true,
            output: "Installed the required local fixture configuration",
          };
        },
        "destructive",
      );
    },
  );
  assert.equal(attempts, 4, context);
});

test("commands differing after 200 characters are not reported as identical work", async () => {
  const prefix =
    "Inspect this long artifact path and preserve these arguments: " +
    "a".repeat(240);
  const context = await run(
    [
      {
        name: "inspect_fixture",
        args: JSON.stringify({ command: prefix + "offset=10" }),
      },
      {
        name: "inspect_fixture",
        args: JSON.stringify({ command: prefix + "offset=20" }),
      },
    ],
    (h) =>
      tool(h, "inspect_fixture", async () => ({
        ok: true,
        output: "A different record",
      })),
  );
  assert.doesNotMatch(context, /already called with identical arguments/);
});

test("distinct read ranges do not trigger a reread prohibition even when their contents match", async () => {
  const calls = Array.from({ length: 4 }, (_, offset) => ({
    name: "read_file",
    args: JSON.stringify({ path: "parser.py", offset, limit: 1 }),
  }));
  const context = await run(calls, (h) =>
    tool(h, "read_file", async () => ({
      ok: true,
      output: "The same bytes in a different range",
    })),
  );
  assert.doesNotMatch(
    context,
    /do not call read_file on this path again|Repeated full read_file/,
  );
});

test("unchanged read arguments after a successful edit are fresh verification, not duplicate work", async () => {
  const calls: Call[] = [];
  for (let i = 0; i < 4; i++) {
    if (i)
      calls.push({
        name: "write_file",
        args: JSON.stringify({ path: "parser.py", content: "revision " + i }),
      });
    calls.push({
      name: "read_file",
      args: JSON.stringify({ path: "parser.py" }),
    });
  }
  const context = await run(calls, (h) => {
    tool(
      h,
      "write_file",
      async () => ({ ok: true, output: "Saved a new revision" }),
      "destructive",
    );
    tool(h, "read_file", async () => ({
      ok: true,
      output: "Verification passed",
    }));
  });
  assert.doesNotMatch(
    context,
    /already called with identical arguments|Repeated identical read_file|reuse this observation/,
  );
});

test("an explicitly requested artifact connector cannot be silently skipped at completion", async () => {
  const ends: any[] = [];
  const context = await run([], (h) => {
    (h as any).requestedArtifactConnectorsThisSend = ["rea"];
    tool(h, "mcp_rea_inspect_fixture", async () => ({
      ok: true,
      output: "fixture",
    }));
    h.registry.setToolFamilyLookup(
      new Map([["mcp_rea_inspect_fixture", "connector:rea:session"]]),
    );
    h.emitter.on("turn_end", (e) => ends.push(e));
  });
  assert.equal(
    (context.match(/UNFINISHED REQUESTED TOOL STEP/g) ?? []).length,
    1,
  );
  assert.match(context, /tool step is still incomplete/);
  assert.equal(ends.length, 1);
  assert.equal(ends[0].harnessMetrics.terminationReason, "error");
});

test("attempting the requested artifact connector satisfies the tool-use requirement", async () => {
  const context = await run(
    [{ name: "mcp_rea_inspect_fixture", args: "{}" }],
    (h) => {
      (h as any).requestedArtifactConnectorsThisSend = ["rea"];
      tool(h, "mcp_rea_inspect_fixture", async () => ({
        ok: false,
        error: "Unsupported fixture architecture",
      }));
      h.registry.setToolFamilyLookup(
        new Map([["mcp_rea_inspect_fixture", "connector:rea:session"]]),
      );
    },
  );
  assert.doesNotMatch(
    context,
    /UNFINISHED REQUESTED TOOL STEP|tool step is still incomplete/,
  );
});

test('repeated program failures get one diagnostic budget without changing model or effort',async()=>{
 let state:any;const budget={reasoningEffort:'medium',thinkDepth:'brief',toolFirstBias:true,reasoningWordBudget:140,essayRisk:true,source:'fallback'};
 const calls=[1,2,3].map(i=>({name:'run_shell',args:JSON.stringify({command:'parser-attempt-'+i})}));
 const context=await run(calls,h=>{
  state=h as any;state._turnReasoningBudget={...budget};state._turnReasoningSurface='external';
  tool(h,'run_shell',async()=>({ok:false,error:'Exit code 1.\nInvalid parser offset'}),'destructive');
 });
 assert.equal((context.match(/\[DIAGNOSTIC RECOVERY\]/g)??[]).length,1);
 assert.equal(state._turnReasoningBudget.reasoningEffort,'medium');
 assert.equal(state._turnReasoningBudget.toolFirstBias,true);
 assert.equal(state._turnReasoningBudget.thinkDepth,'standard');
 assert.equal(state._turnReasoningSurface,'external');
 assert.equal(state.config.model,'fixture');
 assert(state._turnReasoningBudget.reasoningWordBudget>budget.reasoningWordBudget);
});
