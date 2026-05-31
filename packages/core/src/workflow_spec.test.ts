import test from "node:test";
import assert from "node:assert/strict";
import {
  parseWorkflowSpec,
  topoSortPhases,
  buildPlanWorkflowPrompt,
  detectWorkflowSignal,
  defaultFamiliesForKind,
  inferWorkflowTaskFamilies,
  WORKFLOW_MAX_TASKS_PER_PHASE,
  type WorkflowPhaseSpec,
} from "./workflow_spec.js";

function goodSpec(): unknown {
  return {
    goal: "audit endpoints",
    phases: [
      { id: "understand", kind: "understand", goal: "map routes", fanOut: { tasks: [{ goal: "list routes" }] } },
      {
        id: "execute",
        kind: "execute",
        goal: "check each",
        dependsOn: ["understand"],
        fanOut: { tasks: [{ goal: "check route A" }, { goal: "check route B" }] },
        verify: { gate: "run_tests", onFail: "iterate" },
        converge: { maxIterations: 3 },
      },
    ],
  };
}

test("parseWorkflowSpec accepts a valid spec and normalizes it", () => {
  const r = parseWorkflowSpec(goodSpec());
  assert.ok(r.ok, r.ok ? "" : r.error);
  if (!r.ok) return;
  assert.equal(r.spec.phases.length, 2);
  assert.equal(r.spec.phases[1]!.dependsOn?.[0], "understand");
  assert.equal(r.spec.phases[1]!.verify?.gate, "run_tests");
  assert.equal(r.spec.phases[1]!.converge?.maxIterations, 3);
});

test("parseWorkflowSpec rejects junk", () => {
  assert.equal(parseWorkflowSpec(null).ok, false);
  assert.equal(parseWorkflowSpec({ phases: [] }).ok, false); // no goal
  assert.equal(parseWorkflowSpec({ goal: "x", phases: [] }).ok, false); // empty phases
  assert.equal(
    parseWorkflowSpec({ goal: "x", phases: [{ goal: "p", fanOut: { tasks: [] } }] }).ok,
    false // no valid tasks
  );
});

test("parseWorkflowSpec assigns missing ids and dedups them", () => {
  const r = parseWorkflowSpec({
    goal: "g",
    phases: [
      { goal: "a", fanOut: { tasks: [{ goal: "t" }] } },
      { goal: "b", fanOut: { tasks: [{ goal: "t" }] } },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  const ids = r.spec.phases.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "ids must be unique");
});

test("parseWorkflowSpec enforces per-phase task cap", () => {
  const tasks = Array.from({ length: WORKFLOW_MAX_TASKS_PER_PHASE + 1 }, (_, i) => ({ goal: `t${i}` }));
  const r = parseWorkflowSpec({ goal: "g", phases: [{ goal: "p", fanOut: { tasks } }] });
  assert.equal(r.ok, false);
});

test("topoSortPhases orders by dependsOn and detects cycles", () => {
  const r = parseWorkflowSpec(goodSpec());
  assert.ok(r.ok);
  if (!r.ok) return;
  const ordered = topoSortPhases(r.spec.phases);
  assert.ok(ordered.ok);
  if (!ordered.ok) return;
  assert.deepEqual(ordered.order.map((p) => p.id), ["understand", "execute"]);

  const cyclic: WorkflowPhaseSpec[] = [
    { id: "a", kind: "custom", goal: "a", dependsOn: ["b"], fanOut: { tasks: [{ goal: "t" }] } },
    { id: "b", kind: "custom", goal: "b", dependsOn: ["a"], fanOut: { tasks: [{ goal: "t" }] } },
  ];
  assert.equal(topoSortPhases(cyclic).ok, false);
});

test("parseWorkflowSpec keeps known toolFamilies and drops unknown ones", () => {
  const r = parseWorkflowSpec({
    goal: "g",
    phases: [
      {
        goal: "p",
        fanOut: { tasks: [{ goal: "t", toolFamilies: ["code_intel", "BOGUS", "shell"] }] },
      },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.spec.phases[0]!.fanOut.tasks[0]!.toolFamilies, ["code_intel", "shell"]);
});

test("parseWorkflowSpec accepts legacy activateTools as families", () => {
  const r = parseWorkflowSpec({
    goal: "g",
    phases: [{ goal: "p", fanOut: { tasks: [{ goal: "t", activateTools: ["browser"] }] } }],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.spec.phases[0]!.fanOut.tasks[0]!.toolFamilies, ["browser"]);
});

test("defaultFamiliesForKind gives verify agents shell+browser+code_intel", () => {
  assert.deepEqual(defaultFamiliesForKind("verify").sort(), ["browser", "code_intel", "shell"]);
  assert.ok(defaultFamiliesForKind("execute").includes("files_edit"));
  assert.ok(defaultFamiliesForKind("review").includes("web"));
});

test("inferWorkflowTaskFamilies adds web for research goals", () => {
  const fams = inferWorkflowTaskFamilies(
    "Research TAM and competitor pricing for therapy notes",
    "custom"
  );
  assert.ok(fams.includes("web"));
  assert.ok(fams.includes("markets"));
  assert.ok(fams.includes("memory_advanced"));
});

test("buildPlanWorkflowPrompt asks for JSON and includes the goal", () => {
  const p = buildPlanWorkflowPrompt("migrate to Bun", ["shell"]);
  assert.match(p, /JSON ONLY/i);
  assert.match(p, /migrate to Bun/);
});

test("detectWorkflowSignal fires on workflow-worthy tasks", () => {
  const cases: string[] = [
    "run a workflow to build a dashboard", // explicit
    "audit every endpoint under src/routes for missing auth checks", // audit/sweep
    "check all components for accessibility issues", // every/all + noun
    "migrate all class components to hooks across the codebase", // migration
    "refactor every module to use the new logger", // refactor at scale
    "spin up parallel agents to research this", // explicit parallelism
    "Phase 1: research. Phase 2: build. Phase 3: verify.", // multi-phase
    "research the competitors and pricing for this market", // multi-angle research
    "do an adversarial review of these findings", // cross-check
    "build several components in parallel for the page", // parallel build
  ];
  for (const c of cases) {
    const r = detectWorkflowSignal(c);
    assert.equal(r.match, true, `should match: "${c}"`);
    assert.ok(r.reason.length > 0);
  }
});

test("detectWorkflowSignal stays quiet on small single-step tasks", () => {
  const negatives = [
    "add a debounce helper to utils.ts",
    "fix the typo in the README",
    "what does this function do?",
    "rename this variable to userId",
    "explain how the auth flow works",
  ];
  for (const n of negatives) {
    assert.equal(detectWorkflowSignal(n).match, false, `should NOT match: "${n}"`);
  }
});
