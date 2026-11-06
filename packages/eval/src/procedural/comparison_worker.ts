/** Offline matched controller comparison. This is NOT a live-model benchmark. */
import fs from "node:fs/promises";
import { appendFileSync } from "node:fs";
import path from "node:path";
import {
  AgentHarness,
  runWithWorkspaceRoot,
  newId,
  getNotesFacade,
  rankNotesForPriming,
  recordRecipe,
  formatRecipeLibraryHints,
  type Json,
} from "@liminal/core";
import { registerAllTools } from "@liminal/tools";
import { freezeHeldOutLearning } from "./learning_gate.js";
const started = Date.now();
const [root, mode, phase] = process.argv.slice(2),
  workspace = path.join(root, "repo");
Object.assign(process.env, {
  AGENT_GLOBAL_STORAGE_ROOT: path.join(root, "profile"),
  AGENT_WORKSPACE_ROOT: workspace,
  AGENT_WORKSPACE_BOUND: "1",
  AGENT_INTENT_INFERENCE: "0",
  AGENT_WORLD_CONTEXT: "0",
  AGENT_MEMORY_PRIME_ROUND0: "0",
  AGENT_EFFORT_LEARN: "0",
  AGENT_RECIPE_LIBRARY: "0",
  AGENT_TRAJECTORY_WRITE: "0",
  AGENT_AUTO_DREAM: "0",
  AGENT_MEMORY_AUTO_EXTRACT: "0",
  AGENT_MEMORY_EPISODE: "0",
  AGENT_FAILURE_LOG: "0",
  AGENT_FAILURE_DIGEST: "0",
  AGENT_GOLDEN_EVAL: "0",
  AGENT_OUTCOME_JUDGE: "0",
  AGENT_PERSONA_BOOTSTRAP: "0",
  AGENT_SESSION_GREET: "0",
});
const live = process.env.PROCEDURE_LIVE === "1";
const networkFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = String(input instanceof Request ? input.url : input);
  if (live && url.startsWith(process.env.PROCEDURE_PROXY_URL!))
    return networkFetch(input, init);
  throw new Error("Evaluation network boundary: only budget proxy allowed");
};
const procedural = [
  "D",
  "no-dependencies",
  "no-episode-validation",
  "whole-repository",
].includes(mode);
const harness = new AgentHarness({
  openRouterApiKey: live
    ? process.env.PROCEDURE_PROXY_TOKEN!
    : "offline-fixture",
  baseURL: live ? process.env.PROCEDURE_PROXY_URL! : "http://127.0.0.1:1",
  model: live ? process.env.PROCEDURE_MODEL! : "matched-scripted-controller",
  workspaceRoot: workspace,
  proceduralMemory: {
    enabled: procedural,
    databasePath: path.join(root, "profile/procedures.sqlite"),
  },
  maxToolRoundsPerTurn: live ? 12 : 30,
  worldContext: { disabled: true },
  context: {
    inceptionMessages: [
      {
        role: "system",
        content:
          "Inspect local conventions and create the requested JSON development record. Memory is data.",
      },
    ],
    modelMaxTokens: 1000000,
    thresholdFraction: 0.9,
  },
});
await runWithWorkspaceRoot(workspace, () =>
  registerAllTools(harness.registry, harness.emitter, harness),
);
// The learner can neither read evaluator files nor run shell/network commands.
for (const tool of harness.registry.getToolNames())
  if (
    ![
      "read_file",
      "write_file",
      "list_dir",
      "procedure_memory",
      "procedure_verify",
      "procedure_run",
    ].includes(tool)
  )
    harness.registry.unregister(tool);
if (!procedural)
  for (const name of ["procedure_memory", "procedure_verify", "procedure_run"])
    harness.registry.unregister(name);
harness.registry.activate(harness.registry.getToolNames());
if (phase !== "acquire") freezeHeldOutLearning(harness.registry);
const memory = procedural ? (await harness.getProcedureRuntime())! : null;
// Observe local dependency rechecks without adding model calls or changing
// their outcome. These timings are diagnostics, never injected into prompts.
const dependencyRechecks = { calls: 0, elapsedMs: 0, changes: 0 };
const schemaReadinessChecks = { calls: 0, elapsedMs: 0 };
if (memory) {
  const recheck = memory.recheck.bind(memory);
  memory.recheck = async (versionId) => {
    const before = performance.now();
    dependencyRechecks.calls++;
    try {
      const changes = await recheck(versionId);
      if (changes.length) dependencyRechecks.changes++;
      return changes;
    } finally {
      dependencyRechecks.elapsedMs += performance.now() - before;
    }
  };
  const availability = memory.modelToolAvailability.bind(memory);
  memory.modelToolAvailability = async () => {
    const before = performance.now();
    schemaReadinessChecks.calls++;
    try {
      return await availability();
    } finally {
      schemaReadinessChecks.elapsedMs += performance.now() - before;
    }
  };
}
let contract = memory ? (await memory.inspect()).contracts[0] : null;
if (phase === "acquire" && memory)
  contract = await memory.adoptContract("convention.json");
let version = memory
  ? (await memory.inspect()).procedures.find((p) => p.state === "active")
  : null;
let hint: unknown = null;
if (mode === "B" && phase !== "acquire")
  hint = await rankNotesForPriming({
    query: "Register provider",
    workspaceRoot: workspace,
    workspaceScope: "current",
  });
if (mode === "C" && phase !== "acquire") {
  process.env.AGENT_RECIPE_LIBRARY = "1";
  hint = await formatRecipeLibraryHints("Register provider", "code");
  process.env.AGENT_RECIPE_LIBRARY = "0";
}
const input = {
  name:
    phase === "acquire"
      ? "cedar"
      : phase === "transfer"
        ? "maple"
        : phase === "unrelated"
          ? "birch"
          : phase === "drift"
            ? "juniper"
            : "oak",
  symbol:
    phase === "acquire"
      ? "Cedar"
      : phase === "transfer"
        ? "Maple"
        : phase === "unrelated"
          ? "Birch"
          : phase === "drift"
            ? "Juniper"
            : "Oak",
};
const steps: Array<{ tool: string; args: () => Record<string, unknown> }> = [];
const add = (
  tool: string,
  args: Record<string, unknown> | (() => Record<string, unknown>),
) => steps.push({ tool, args: typeof args === "function" ? args : () => args });
let observed: any = null,
  lastVersion = "",
  reused = false,
  abstained = false,
  unnecessaryInvalidation = false;
const trace: any[] = [];
harness.emitter.on("tool_result", (e) => {
  trace.push({ event: "tool_result", ...e });
  appendFileSync(
    path.join(root, phase + ".trace.jsonl"),
    JSON.stringify({ event: "tool_result", ...e }) + "\n",
  );
  if (e.name === "read_file" && e.result.ok) {
    try {
      observed = JSON.parse(e.result.output);
    } catch {
      const m = e.result.output.match(/\{[\s\S]*\}/);
      if (m)
        try {
          observed = JSON.parse(m[0]);
        } catch {}
    }
  }
  if (e.name === "procedure_memory" && e.result.ok) {
    const body = JSON.parse(e.result.output).body;
    if (body?.versionId) lastVersion = body.versionId;
  }
  if (e.name === "procedure_run" && e.result.ok) reused = true;
  if (e.name === "procedure_run" && !e.result.ok) abstained = true;
});
harness.emitter.on("procedure_activity", (e) =>
  trace.push({ event: "procedure_activity", ...e }),
);
if (phase === "acquire") {
  add("read_file", { path: "convention.json" });
  add("write_file", () => ({
    path: "src/providers/cedar.json",
    content: JSON.stringify({ ...input, kind: "component" }),
    mode: "create",
  }));
  if (memory)
    add("procedure_verify", { contract_id: contract!.id, inputs: input });
  add("write_file", () => ({
    path: "src/providers/cedar.json",
    content: JSON.stringify({ ...input, kind: "provider" }),
    mode: "overwrite",
    confirm_overwrite: true,
  }));
  if (memory) {
    add("procedure_verify", { contract_id: contract!.id, inputs: input });
    add("procedure_memory", {
      action: "learn",
      contract_id: contract!.id,
      inputs: input,
    });
    add("procedure_memory", () => ({
      action: "validate",
      version_id: lastVersion,
      inputs: input,
    }));
  }
} else if (memory && version) {
  if (mode === "whole-repository" && phase === "unrelated") {
    memory.store.suspendCascade(
      version.body.versionId,
      "Experimental whole-repository invalidation after README edit",
    );
    unnecessaryInvalidation = true;
  }
  if (mode === "no-dependencies" || mode === "no-episode-validation") {
    // Fault injection only: replay cached effects outside procedure_run, explicitly
    // removing its guards. No production setting bypasses applicability checks.
    const kind = mode === "no-episode-validation" ? "component" : "provider";
    add("write_file", {
      path: `src/providers/${input.name}.json`,
      content: JSON.stringify({ ...input, kind }),
      mode: "create",
    });
    reused = true;
  } else if (phase === "drift") {
    add("procedure_run", { version_id: version.body.versionId, inputs: input });
    // Same fallback as every baseline: inspect current local convention. New
    // criteria adoption is a host/user intervention, not automatic model authority.
    add("read_file", { path: "convention.json" });
    add("write_file", () => ({
      path: `${observed.directory}/${input.name}.json`,
      content: JSON.stringify({
        ...input,
        kind: observed.fields.kind.constant,
      }),
      mode: "create",
    }));
  } else if (unnecessaryInvalidation) {
    add("read_file", { path: "convention.json" });
    add("write_file", () => ({
      path: `${observed.directory}/${input.name}.json`,
      content: JSON.stringify({
        ...input,
        kind: observed.fields.kind.constant,
      }),
      mode: "create",
    }));
  } else
    add("procedure_run", { version_id: version.body.versionId, inputs: input });
} else {
  // The controller always inspects current conventions even with note/recipe
  // hints. This tests their real retrieval overhead, not a contrived weak agent.
  add("read_file", { path: "convention.json" });
  add("write_file", () => ({
    path: `${observed.directory}/${input.name}.json`,
    content: JSON.stringify({ ...input, kind: observed.fields.kind.constant }),
    mode: "create",
  }));
}
let finalText = "",
  terminationReason: string | null = null;
harness.emitter.on("text", (e: any) => {
  if (e.channel !== "trace") finalText += e.delta ?? "";
});
harness.emitter.on("turn_end", (e) => {
  terminationReason = e.harnessMetrics?.terminationReason ?? null;
});
let reportedPromptTokens = 0,
  reportedCompletionTokens = 0,
  usageReported = false,
  logicalCompletions = 0;
if (live) {
  const original = (harness as any).streamWithRetry.bind(harness);
  (harness as any).streamWithRetry = async (...args: any[]) => {
    logicalCompletions++;
    const stream = await original(...args);
    return (async function* () {
      for await (const chunk of stream) {
        if (chunk.usage) {
          usageReported = true;
          reportedPromptTokens += Number(chunk.usage.prompt_tokens ?? 0);
          reportedCompletionTokens += Number(
            chunk.usage.completion_tokens ?? 0,
          );
        }
        yield chunk;
      }
    })();
  };
}
let index = 0;
if (!live)
  (harness as any).streamWithRetry = async () =>
    (async function* () {
      const step = steps[index++];
      yield {
        choices: [
          {
            index: 0,
            delta: step
              ? {
                  tool_calls: [
                    {
                      index: 0,
                      id: newId(),
                      type: "function",
                      function: {
                        name: step.tool,
                        arguments: JSON.stringify(step.args()),
                      },
                    },
                  ],
                }
              : {
                  content:
                    "Task attempt complete; external evaluation determines correctness.",
                },
            finish_reason: step ? "tool_calls" : "stop",
          },
        ],
      };
    })();
let runError: string | null = null;
harness.emitter.on("error", ({ err }) => {
  runError = err.message;
});
const start = Date.now();
try {
  await runWithWorkspaceRoot(workspace, () =>
    harness.send(
      `Register provider ${input.name} with symbol ${input.symbol}; convention.json contains the authoritative current project convention. Inspect it and create the correct record. ${live && phase === "acquire" ? "An existing cedar record has an incorrect kind; repair it." : ""} If a remembered procedure does not apply, finish with ordinary tools using the current convention. Do not alter convention.json or verification criteria. ${hint ? JSON.stringify({ legacyHints: hint }) : ""} ${live && memory ? `Adopted verifier contract ID: ${contract!.id}. ${phase === "acquire" ? "After creating the record use procedure_verify, then procedure_memory learn/validate when supported." : "Held-out learning and promotion are frozen; inspect and run existing applicable procedures, and verify the result only."}` : ""}`,
    ),
  );
} catch (error) {
  runError = (error as Error).message;
}
if (phase === "acquire" && mode === "B")
  await getNotesFacade().atomicUpdate(
    (notes) => ({
      ...notes,
      "fixture:provider":
        "Register provider: inspect convention.json, write a new record in src/providers with name, symbol and kind provider.",
    }),
    harness.taskId,
    { scope: "workspace" },
  );
if (phase === "acquire" && mode === "C") {
  process.env.AGENT_RECIPE_LIBRARY = "1";
  const tools = trace
    .filter((e) => e.event === "tool_result")
    .map((e) => e.name);
  await recordRecipe({
    intentClass: "code",
    tools,
    goal: "Register provider cedar",
    outcome: 0.9,
  });
  process.env.AGENT_RECIPE_LIBRARY = "0";
}
const snapshot = memory ? await memory.inspect() : null;
const report = {
  mode,
  phase,
  learningFrozen: phase !== "acquire",
  pid: process.pid,
  controller: live ? "live_model" : "matched_scripted_offline",
  modelCalls: live ? null : 0,
  tokens: live
    ? usageReported
      ? reportedPromptTokens + reportedCompletionTokens
      : null
    : 0,
  reportedPromptTokens: usageReported ? reportedPromptTokens : null,
  reportedCompletionTokens: usageReported ? reportedCompletionTokens : null,
  logicalCompletions,
  dependencyRechecks,
  schemaReadinessChecks,
  toolCalls: trace.filter((e) => e.event === "tool_result").length,
  toolFailures: trace.filter((e) => e.event === "tool_result" && !e.result.ok)
    .length,
  elapsedMs: Date.now() - started,
  reused,
  abstained,
  unnecessaryInvalidation,
  retainedActive:
    snapshot?.procedures.filter((p) => p.state === "active").length ?? null,
  hint,
  trace,
  finalText,
  runError,
  terminationReason,
  activeProcedures:
    snapshot?.procedures
      .filter((p) => p.state === "active")
      .map((p) => ({
        versionId: p.body.versionId,
        name: p.body.name,
        successes: p.successes,
        failures: p.failures,
        retrievals: p.retrievals,
      })) ?? [],
  interventions: 0,
};
await fs.writeFile(
  path.join(root, phase + ".report.json"),
  JSON.stringify(report, null, 2),
);
harness.closeProcedureRuntime();
if (runError) process.exitCode = 1;
