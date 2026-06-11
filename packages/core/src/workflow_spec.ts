/**
 * Dynamic-workflow spec — declarative orchestration the model authors and the
 * WorkflowRuntime interprets (it is NOT executed as code). A workflow is a list
 * of phases; each phase fans out independent sub-agent tasks, optionally has an
 * adversarial review pass and a verification gate, and folds only a distilled
 * summary back into the parent context.
 *
 * Pure module: types + validation/parse + the fast-model planning prompt +
 * phase topological ordering. No fs / network / harness imports — safe to unit
 * test and to share between the tool layer and the runtime. Mirrors the shape
 * of memory_curator.ts / output_effort.ts.
 */

export type WorkflowPhaseKind = "understand" | "execute" | "verify" | "review" | "custom";
export type WorkflowVerifyGate = "run_tests" | "run_lint" | "critic";

export interface WorkflowTaskSpec {
  goal: string;
  /** Restrict the sub-agent to these tools (allowlist). */
  toolNames?: string[];
  /** Tool FAMILIES the sub-agent needs (e.g. "code_intel", "shell", "browser"). */
  toolFamilies?: string[];
  /** Extra context handed to the sub-agent. */
  additionalContext?: string;
}

/** Activatable tool families a workflow task may request. Unknown names are dropped. */
export const WORKFLOW_KNOWN_FAMILIES: readonly string[] = [
  "files_edit",
  "shell",
  "git",
  "web",
  "browser",
  "code_intel",
  "navigation",
  "memory_advanced",
  "vault",
  "document",
  "vision",
  "markets",
  "tasks",
];

/**
 * Tool families every sub-agent of a given phase kind should have, so an agent
 * is never starved even when the planner under-specifies. Unioned with the
 * planner's declared families. Read/write/grep/web_search are always loaded by
 * the baseline, so these add the activation-gated capabilities.
 */
export function defaultFamiliesForKind(kind: WorkflowPhaseKind): string[] {
  switch (kind) {
    case "understand":
      return ["navigation", "code_intel", "web", "memory_advanced"];
    case "execute":
      return ["files_edit", "code_intel", "shell"];
    case "verify":
      return ["code_intel", "shell", "browser"];
    case "review":
      return ["web", "code_intel", "memory_advanced"];
    default:
      return ["files_edit", "code_intel", "web", "navigation"];
  }
}

/** Research / market / regulatory goals need live web tools under lazy loading. */
const WORKFLOW_RESEARCH_GOAL_RE =
  /\b(research|tam|market|competitor|pricing|regulatory|hipaa|sources?|citation|peers?|landscape|survey|compliance|statute|consent|bls|cagr|competitors?)\b/i;

/** Merge phase defaults, planner families, and goal-inferred families (filtered to known ids). */
export function inferWorkflowTaskFamilies(
  goal: string,
  phaseKind: WorkflowPhaseKind,
  declared?: readonly string[]
): string[] {
  const known = new Set(WORKFLOW_KNOWN_FAMILIES);
  const out = new Set<string>();
  for (const f of [...defaultFamiliesForKind(phaseKind), ...(declared ?? [])]) {
    const id = f.trim().toLowerCase();
    if (known.has(id)) out.add(id);
  }
  if (WORKFLOW_RESEARCH_GOAL_RE.test(goal)) {
    for (const f of ["web", "memory_advanced", "markets"] as const) out.add(f);
  }
  if (
    /\b(save|write|create|output|deliver|produce|draft|persist)\b[\s\S]{0,48}\b(file|files|document|markdown|\.md|report)\b/i.test(
      goal
    )
  ) {
    out.add("files_edit");
  }
  if (phaseKind === "review" || /\badversarial\b/i.test(goal)) {
    out.add("web");
    out.add("code_intel");
  }
  return [...out];
}

/** Explicit web tool names — lazy mode does not guarantee baseline unless activated on the child registry. */
export const WORKFLOW_WEB_ACTIVATE_TOOLS = ["web_search", "web_fetch", "http_request"] as const;

export function workflowNeedsWebTools(families: readonly string[], goal: string): boolean {
  return families.includes("web") || WORKFLOW_RESEARCH_GOAL_RE.test(goal);
}

export interface WorkflowVerifySpec {
  gate: WorkflowVerifyGate;
  /** On failure: stop the run, or re-run the phase with the failure as context. */
  onFail: "stop" | "iterate";
  /** Optional command/path passed to the gate (e.g. a test path). */
  command?: string;
}

export interface WorkflowPhaseSpec {
  id: string;
  kind: WorkflowPhaseKind;
  goal: string;
  fanOut: { tasks: WorkflowTaskSpec[] };
  /** Phase ids that must complete before this one runs. */
  dependsOn?: string[];
  /** Max concurrent sub-agents in this phase (clamped by the runtime's cap). */
  concurrency?: number;
  /** "adversarial" spawns reviewers over this phase's outputs before summarizing. */
  review?: "adversarial" | "none";
  verify?: WorkflowVerifySpec;
  /** Bounds the verify→iterate loop. */
  converge?: { maxIterations: number };
}

export interface WorkflowSpec {
  id: string;
  goal: string;
  phases: WorkflowPhaseSpec[];
}

// Structural caps — reject pathological specs early. The runtime additionally
// enforces the runtime agent cap (AGENT_WORKFLOW_MAX_AGENTS) at execution time.
export const WORKFLOW_MAX_PHASES = 16;
export const WORKFLOW_MAX_TASKS_PER_PHASE = 32;
export const WORKFLOW_MAX_TOTAL_TASKS = 200;

const PHASE_KINDS = new Set<WorkflowPhaseKind>(["understand", "execute", "verify", "review", "custom"]);
const VERIFY_GATES = new Set<WorkflowVerifyGate>(["run_tests", "run_lint", "critic"]);

function asTrimmedString(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t.slice(0, max);
}

function parseTask(raw: unknown): WorkflowTaskSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const goal = asTrimmedString(o["goal"], 1200);
  if (!goal) return null;
  const task: WorkflowTaskSpec = { goal };
  if (Array.isArray(o["toolNames"])) {
    task.toolNames = (o["toolNames"] as unknown[]).filter((x): x is string => typeof x === "string");
  }
  // Accept `toolFamilies` (preferred) or a legacy `activateTools` alias; keep
  // only known activatable families.
  const famRaw = Array.isArray(o["toolFamilies"])
    ? (o["toolFamilies"] as unknown[])
    : Array.isArray(o["activateTools"])
      ? (o["activateTools"] as unknown[])
      : [];
  const fams = famRaw
    .filter((x): x is string => typeof x === "string")
    .map((x) => x.trim().toLowerCase())
    .filter((x) => WORKFLOW_KNOWN_FAMILIES.includes(x));
  if (fams.length > 0) task.toolFamilies = [...new Set(fams)];
  const add = asTrimmedString(o["additionalContext"], 4000);
  if (add) task.additionalContext = add;
  return task;
}

function parseVerify(raw: unknown): WorkflowVerifySpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const gate = o["gate"];
  if (typeof gate !== "string" || !VERIFY_GATES.has(gate as WorkflowVerifyGate)) return undefined;
  const onFail = o["onFail"] === "iterate" ? "iterate" : "stop";
  const v: WorkflowVerifySpec = { gate: gate as WorkflowVerifyGate, onFail };
  const command = asTrimmedString(o["command"], 400);
  if (command) v.command = command;
  return v;
}

export type ParseWorkflowResult = { ok: true; spec: WorkflowSpec } | { ok: false; error: string };

/**
 * Validate + normalize an untrusted (LLM-authored) workflow spec. Assigns
 * missing ids, clamps counts, validates dependsOn references and rejects cycles.
 */
export function parseWorkflowSpec(raw: unknown): ParseWorkflowResult {
  if (!raw || typeof raw !== "object") return { ok: false, error: "spec must be an object" };
  const o = raw as Record<string, unknown>;

  const goal = asTrimmedString(o["goal"], 2000);
  if (!goal) return { ok: false, error: "spec.goal is required" };

  const rawPhases = o["phases"];
  if (!Array.isArray(rawPhases) || rawPhases.length === 0) {
    return { ok: false, error: "spec.phases must be a non-empty array" };
  }
  if (rawPhases.length > WORKFLOW_MAX_PHASES) {
    return { ok: false, error: `too many phases (max ${WORKFLOW_MAX_PHASES})` };
  }

  const id = asTrimmedString(o["id"], 80) ?? `wf_${Date.now().toString(36)}`;
  const phases: WorkflowPhaseSpec[] = [];
  const seenIds = new Set<string>();
  let totalTasks = 0;

  for (let i = 0; i < rawPhases.length; i++) {
    const rp = rawPhases[i];
    if (!rp || typeof rp !== "object") return { ok: false, error: `phase ${i} is not an object` };
    const p = rp as Record<string, unknown>;

    let pid = asTrimmedString(p["id"], 60) ?? `p${i}`;
    if (seenIds.has(pid)) pid = `${pid}_${i}`;
    seenIds.add(pid);

    const pgoal = asTrimmedString(p["goal"], 1200);
    if (!pgoal) return { ok: false, error: `phase ${pid}: goal is required` };

    const kindRaw = typeof p["kind"] === "string" ? (p["kind"] as string) : "custom";
    const kind: WorkflowPhaseKind = PHASE_KINDS.has(kindRaw as WorkflowPhaseKind)
      ? (kindRaw as WorkflowPhaseKind)
      : "custom";

    const fanOutRaw = p["fanOut"] as Record<string, unknown> | undefined;
    const tasksRaw = Array.isArray(fanOutRaw?.["tasks"]) ? (fanOutRaw!["tasks"] as unknown[]) : [];
    const tasks = tasksRaw.map(parseTask).filter((t): t is WorkflowTaskSpec => t !== null);
    if (tasks.length === 0) return { ok: false, error: `phase ${pid}: fanOut.tasks must have ≥1 valid task` };
    if (tasks.length > WORKFLOW_MAX_TASKS_PER_PHASE) {
      return { ok: false, error: `phase ${pid}: too many tasks (max ${WORKFLOW_MAX_TASKS_PER_PHASE})` };
    }
    totalTasks += tasks.length;
    if (totalTasks > WORKFLOW_MAX_TOTAL_TASKS) {
      return { ok: false, error: `too many total tasks across phases (max ${WORKFLOW_MAX_TOTAL_TASKS})` };
    }

    const phase: WorkflowPhaseSpec = { id: pid, kind, goal: pgoal, fanOut: { tasks } };

    if (Array.isArray(p["dependsOn"])) {
      phase.dependsOn = (p["dependsOn"] as unknown[]).filter((x): x is string => typeof x === "string");
    }
    if (typeof p["concurrency"] === "number" && Number.isFinite(p["concurrency"])) {
      phase.concurrency = Math.max(1, Math.min(WORKFLOW_MAX_TASKS_PER_PHASE, Math.round(p["concurrency"] as number)));
    }
    if (p["review"] === "adversarial") phase.review = "adversarial";
    const verify = parseVerify(p["verify"]);
    if (verify) phase.verify = verify;
    const conv = p["converge"] as Record<string, unknown> | undefined;
    if (conv && typeof conv["maxIterations"] === "number" && Number.isFinite(conv["maxIterations"])) {
      phase.converge = { maxIterations: Math.max(1, Math.min(5, Math.round(conv["maxIterations"] as number))) };
    }

    phases.push(phase);
  }

  // Validate dependsOn references point at known phases (drop unknowns).
  for (const phase of phases) {
    if (phase.dependsOn) {
      phase.dependsOn = phase.dependsOn.filter((d) => seenIds.has(d) && d !== phase.id);
      if (phase.dependsOn.length === 0) delete phase.dependsOn;
    }
  }

  const ordered = topoSortPhases(phases);
  if (!ordered.ok) return { ok: false, error: ordered.error };

  return { ok: true, spec: { id, goal, phases } };
}

export type TopoResult = { ok: true; order: WorkflowPhaseSpec[] } | { ok: false; error: string };

/** Kahn topological sort over phase dependsOn. Detects cycles. */
export function topoSortPhases(phases: WorkflowPhaseSpec[]): TopoResult {
  const byId = new Map(phases.map((p) => [p.id, p]));
  const indeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const p of phases) {
    indeg.set(p.id, (p.dependsOn ?? []).filter((d) => byId.has(d)).length);
    for (const d of p.dependsOn ?? []) {
      if (!byId.has(d)) continue;
      out.set(d, [...(out.get(d) ?? []), p.id]);
    }
  }
  // Preserve declaration order among ready phases for determinism.
  const ready = phases.filter((p) => (indeg.get(p.id) ?? 0) === 0).map((p) => p.id);
  const order: WorkflowPhaseSpec[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    order.push(byId.get(id)!);
    for (const n of out.get(id) ?? []) {
      const d = (indeg.get(n) ?? 0) - 1;
      indeg.set(n, d);
      if (d === 0) ready.push(n);
    }
  }
  if (order.length !== phases.length) {
    return { ok: false, error: "phase dependsOn forms a cycle" };
  }
  return { ok: true, order };
}

// ─── Where workflows are powerful — turn-intent detection ─────────────────────

export interface WorkflowSignal {
  /** True when the turn looks like a strong fit for a dynamic workflow. */
  match: boolean;
  /** Human-readable reason (for the harness nudge). Empty when no match. */
  reason: string;
}

const NO_SIGNAL: WorkflowSignal = { match: false, reason: "" };

// Code/structural nouns that, when scoped by "every/all/each", imply a fan-out.
const SCOPE_NOUNS =
  "files?|endpoints?|routes?|components?|modules?|functions?|classes?|tools?|pages?|tests?|directories|dirs|services?|handlers?|packages?|screens?|widgets?|tables?|queries|migrations?";

/**
 * Detect whether a user message describes a task where a dynamic workflow is
 * the right tool — i.e. work that fans out into many INDEPENDENT sub-tasks, a
 * large migration/audit, explicit parallelism, a multi-phase plan, or
 * cross-checked multi-angle research. Pure + ordered so the first (most
 * specific) match wins and explains itself. Conservative by design: a small,
 * single-step task must NOT match.
 */
export function detectWorkflowSignal(userMessage: string): WorkflowSignal {
  const t = (userMessage ?? "").toLowerCase();
  if (!t.trim()) return NO_SIGNAL;

  // 1. Explicit — the user said "workflow".
  if (/\bworkflows?\b/.test(t)) return { match: true, reason: "an explicit workflow request" };

  // 2. Explicit parallelism / many sub-agents.
  if (
    /\b(in parallel|parallel agents|concurrent agents|fan[- ]?out|multiple (sub-?)?agents|several (sub-?)?agents|independent agents|spin up (\w+ )?agents|swarm of agents)\b/.test(
      t
    )
  ) {
    return { match: true, reason: "explicitly parallel sub-agents" };
  }

  // 3. Multi-phase plan (Phase 1 … Phase 2 …).
  const phaseHits = t.match(/\bphase\s*\d/g);
  if (phaseHits && phaseHits.length >= 2) {
    return { match: true, reason: "a multi-phase plan" };
  }

  // 4. Audit / sweep across many items.
  if (
    new RegExp(`\\b(audit|sweep|scan|inspect|review|check|verify|find)\\b[^.?!]{0,50}\\b(every|all|each|entire|whole)\\b`).test(t) ||
    new RegExp(`\\b(every|all|each)\\s+(\\w+\\s+){0,3}(${SCOPE_NOUNS})\\b`).test(t)
  ) {
    return { match: true, reason: "an audit/sweep across many items" };
  }

  // 5. Large migration / refactor.
  if (
    new RegExp(`\\b(migrat\\w+|port|convert|upgrade|refactor|rename|replace|modernize)\\w*\\b[^.?!]{0,60}\\b(all|every|each|across|codebase|repo|repository|\\d{2,}\\s*(${SCOPE_NOUNS})|occurrences|call ?sites)\\b`).test(t)
  ) {
    return { match: true, reason: "a large migration/refactor" };
  }

  // 6. Cross-checked / multi-angle research.
  if (
    /\b(adversarial review|cross[- ]?check|cross[- ]?reference|triangulate)\b/.test(t) ||
    (/\bresearch\b/.test(t) && /\b(competitors?|tam|market|landscape|regulatory|pricing|peers?|alternatives?)\b/.test(t))
  ) {
    return { match: true, reason: "cross-checked multi-angle research" };
  }

  // 7. Build that fans out into parallel components.
  if (
    new RegExp(`\\b(build|create|generate|implement)\\b[^.?!]{0,60}\\b(each|several|multiple|set of)\\s+(\\w+\\s+){0,2}(components?|modules?|pages?|widgets?|screens?|services?|agents?)\\b`).test(t)
  ) {
    return { match: true, reason: "a build that fans out into parallel components" };
  }

  return NO_SIGNAL;
}

/** Fast-model prompt that authors a strict-JSON WorkflowSpec for a goal. */
export function buildPlanWorkflowPrompt(goal: string, toolFamilies?: string[]): string {
  const families = toolFamilies && toolFamilies.length > 0 ? toolFamilies.join(", ") : "(default set)";
  return (
    "You design a DYNAMIC WORKFLOW: a multi-phase plan executed by independent sub-agents.\n" +
    "Return JSON ONLY (no markdown fences, no prose outside JSON).\n\n" +
    "Schema:\n" +
    "{\n" +
    '  "goal": "one-line restatement of the objective",\n' +
    '  "phases": [{\n' +
    '    "id": "short_snake_id", "kind": "understand|execute|verify|review|custom",\n' +
    '    "goal": "what this phase achieves",\n' +
    '    "fanOut": { "tasks": [{ "goal": "independent sub-agent task", "toolFamilies": ["code_intel","files_edit"], "additionalContext": "optional" }] },\n' +
    '    "dependsOn": ["earlier_phase_id"],\n' +
    '    "concurrency": 4,\n' +
    '    "review": "adversarial",\n' +
    '    "verify": { "gate": "run_tests|run_lint|critic", "onFail": "iterate", "command": "optional" },\n' +
    '    "converge": { "maxIterations": 2 }\n' +
    "  }]\n" +
    "}\n\n" +
    "Rules:\n" +
    "- Decompose into phases that each fan out into INDEPENDENT tasks that can run in parallel.\n" +
    "- A typical shape is understand → execute → verify. Use dependsOn to order phases.\n" +
    "- Keep tasks self-contained: each is run by a fresh sub-agent with no shared memory.\n" +
    "- For EACH task set `toolFamilies` to the tool families that sub-agent needs to do its job — this is how it gets its tools. " +
    `Choose from: ${WORKFLOW_KNOWN_FAMILIES.join(", ")}. ` +
    "Guidance: writing/editing code → files_edit; running tests/lint or AST/symbol analysis → code_intel; shell commands/builds/serving → shell; " +
    "**web research (TAM, competitors, pricing, regulations) → MUST include toolFamilies: [\"web\"] (and memory_advanced when citing notes)**; " +
    "browser for interactive pages; navigation for repo exploration. Under lazy loading, web_search/web_fetch are NOT visible unless the web family is activated.\n" +
    `- Caller's active tool families (hint): ${families}.\n` +
    `- Be economical: prefer the fewest phases/tasks that accomplish the goal (hard caps: ${WORKFLOW_MAX_PHASES} phases, ${WORKFLOW_MAX_TASKS_PER_PHASE} tasks/phase, ${WORKFLOW_MAX_TOTAL_TASKS} total).\n` +
    "- Add a verify phase/gate when correctness is checkable (tests, lint, or a critic).\n\n" +
    `Goal: ${goal}`
  );
}
