# Dynamic workflows

Dynamic workflows fan a task out into **bounded sub-agents across phases**, keep every
intermediate output in a queryable store **outside the parent context**, and fold only a
distilled summary back in. The parent's context ends up holding an executive report — not
hundreds of raw tool outputs. This is the architecture for codebase-wide audits, large
migrations, parallel component builds, and cross-checked multi-angle research.

Workflows are **root-only** (children never get workflow tools, so they can't nest) and
`run_workflow` is **approval-gated**.

## When to use workflows vs `spawn_agent`

| Use… | When |
| ---- | ---- |
| **Workflows** | Repeatable multi-phase templates: audit → fix → verify, research → debate → write, "build N components in parallel" |
| [`spawn_agent`](./sub-agents-and-orchestration.md) | One-off side tasks where you don't need phase structure |

The harness nudges toward workflows automatically: the fast-model intent classifier sets
`workflowSuitable` when a task fans into many independent sub-tasks, and on a match the
harness **auto-activates the `workflow` family** and suggests `plan_workflow`. (A regex in
`core/workflow_spec.ts` is the fallback when intent inference is off.)

## The two-step flow

1. **`plan_workflow`** — produce or refine a declarative `WorkflowSpec`: phases (topologically
   sorted), tasks per phase, max concurrency, total-agent cap, and an optional verify→iterate
   gate.
2. **`run_workflow`** — execute it (approval-gated). Each phase forks child agents in
   concurrency waves; results land in `.agent_workflows/<runId>/` (BM25-queryable); a fast-model
   summary of each phase folds back into the parent.

Inspect along the way with **`workflow_status`** (running/completed) and **`query_workflow`**
(BM25 search over stored per-agent outputs).

## Cross-phase context

Each phase publishes its full outputs to the session `SharedMemoryBus` under
`ctx/wf/<runId>/<phaseId>`. Later-phase agents receive a concise digest automatically (via
`contextBusPrefix`) plus can `query_workflow` for detail — so "phase 3: implement fixes" sees
"phase 1: audit findings" without you pasting logs. Adversarial-review phases and a
verify gate (`run_tests` / `run_lint` / a critic, bounded by `converge.maxIterations`) let a
workflow self-heal before returning.

## Configuration

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_WORKFLOWS` | on | Master switch for `plan_workflow` / `run_workflow` (root-only) |
| `AGENT_WORKFLOW_MAX_CONCURRENT` | `4` | Max concurrent sub-agents per phase wave (1–16) |
| `AGENT_WORKFLOW_MAX_AGENTS` | `64` | Total sub-agent cap per run (1–500) |
| `AGENT_WORKFLOW_TIMEOUT_MS` | `1800000` | Wall-clock cap for one run |
| `AGENT_WORKFLOW_MODEL` | (fast) | Optional planner/summarizer model slug |

## Example prompt

> "Audit every package for unhandled promise rejections. Phase 1: map each package and list
> candidates. Phase 2 (parallel per package): confirm and propose fixes. Phase 3: apply fixes
> and run tests; iterate until green. Return a summary table of what changed."

The classifier marks this `workflowSuitable`, the `workflow` family activates, and
`plan_workflow` → `run_workflow` executes it in waves.

## Implementation

`core/workflow_spec.ts` (spec + signal), `core/workflow_runtime.ts` (engine: spawn / summarize
/ verify hooks), `core/workflow_store.ts` (`.agent_workflows/<runId>/`). Distinct axis from
`AGENT_EFFORT` (output thoroughness) and the reasoning budget.

See also: [Sub-agents &amp; orchestration](./sub-agents-and-orchestration.md) ·
[Tool families](../reference/tools/index.md).
