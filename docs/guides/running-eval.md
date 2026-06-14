# Running the eval suite

Liminal ships an evaluation suite (`packages/eval`) — 22 scenario packs that exercise the
harness end to end (memory, retrieval, tools, web research, approvals, long-horizon work,
browser, documents, and more). Use it to catch regressions when you change harness behavior.

## Run it

```bash
npm run eval -w packages/eval                  # all scenarios
npm run eval -w packages/eval -- --only memory # filter by name substring
npm run eval -w packages/eval -- --parallel 4  # N parallel workers
npm run eval -w packages/eval -- --repeat 3    # repeat each scenario
npm run eval -w packages/eval -- --any-pass    # pass if any repetition passes
```

The suite needs a working provider key (the same `AGENT_API_KEY` / model config as a normal
run), and `core` + `tools` built first (`npm run build`).

### Sandbox capability lab

Isolated temp workspaces with seeded fixtures — real tool side effects, no monorepo pollution.
See [Sandbox capability lab](./sandbox-capability-lab.md).

```bash
npm run eval:sandbox -w packages/eval
node scripts/sandbox-lab-report.mjs
```

## Scenario packs

`basic`, `reliability`, `harness_reliability`, `noise`, `memory_retrieval`,
`retrieval_precision`, `harness_quality`, `harness_capability`, `epistemic_eval`, `multi_hop`,
`contradiction`, `context_rot`, `approval_correctness`, `web_research_quality`,
`research_grade`, `long_horizon`, `tool_lazy_load`, `large_file_write`, `reasoning_budget`,
`browser_local`, `document_quality`, `document_autonomy`, `sandbox_capability_lab`.

## JSON sink

With `AGENT_EVAL_JSON_SINK` (on by default), each run logs to `.agent_eval_runs/runs.jsonl`
plus a per-run summary JSON — so you can compare runs over time and gate changes on agent
behavior, not just unit tests.

## Tips

- Start with `--only <pack>` while iterating on one subsystem.
- Use `--repeat` + `--any-pass` to distinguish flakes from real regressions.
- Pair with `npm run typecheck` and `npm run test` (core/tools unit tests) for full coverage.

This is the same scenario engine that the proposed **Vireon Bench** product would package for
CI gating — see the [studio roadmap](https://www.vireondynamics.com/roadmap).
