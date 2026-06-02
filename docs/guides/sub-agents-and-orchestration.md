# Sub-agents &amp; orchestration

Liminal can fork **child agents** to parallelize big jobs — refactors, multi-angle research,
independent builds — then merge their results. Orchestration tools are **harness-scoped**:
they're recreated per child (never copied parent → child), and a fixed set
(`ORCHESTRATION_TOOL_NAMES`) stays on the parent so children can't spawn at root.

For declarative, repeatable multi-phase fan-out, prefer
[Dynamic workflows](./dynamic-workflows.md). Use the tools here for flexible, ad-hoc
parallelism.

## Spawning and coordinating

| Tool | Purpose |
| ---- | ------- |
| `spawn_agent` | Fork a child harness with a focused prompt and a scoped tool set |
| `wait_for_agents` | Block until a batch of children finish |
| `list_agents` | Inspect the live fleet mid-turn |
| `cancel_agent` | Stop a runaway child |

`forkChild()` gives each child its own registry slice. `contract_tool_mapper` maps the child's
contract to the right families (web, code_intel, memory) so it starts with what it needs and
nothing more.

## Shared context between agents

Every spawn auto-activates `share_agent_context` / `read_agent_context` over the session
`SharedMemoryBus` (`finalizeChildSpawnTools`). Declare `dependsOn` and a child automatically
receives each dependency's result via `buildUpstreamDependencyContext` — no manual paste.

## Verification &amp; debate

Run critics on outputs, especially code- or path-heavy answers:

| Tool | Purpose |
| ---- | ------- |
| `verify_result` | General result verification (also auto-run when `AGENT_CRITIC` is on) |
| `evidence_critic` / `path_critic` / `policy_critic` | Targeted structured challenges |
| `reflect_debate` | Adversarial pass between positions |
| `verify_contract` | Check execution contracts from `decompose_goal` |
| `branch_explore` / `branch_evaluate` | Explore and score alternative approaches |

## Decomposition &amp; DAG scheduling

- `decompose_goal` — break a goal into subgoals with acceptance criteria.
- `dispatch_graph` — schedule tools within a round when they depend on each other.
- `query_tool_outputs` — query the session tool-output index.
- `synthesis_run` — a cross-domain synthesis sub-agent that merges findings.

## Enabling

Orchestration tools live in the `orchestration` / `reasoning_advanced` / `synthesis` families
and activate on demand (or via the `max_autonomy` profile). They're available only on the root
harness. Telemetry surfaces in the web subtask inspector and session JSONL.

| Variable | Purpose |
| -------- | ------- |
| `AGENT_CRITIC` | Auto-run `verify_result` when the final answer is code/path-heavy |

## When NOT to parallelize

Sub-agents add coordination cost and burn tokens. For a single linear task the main loop is
cheaper and clearer. Reach for sub-agents when work is genuinely independent (per-package,
per-source, per-angle) — and for structured, repeatable fan-out use
[workflows](./dynamic-workflows.md) instead.

See also: [Dynamic workflows](./dynamic-workflows.md) · [Tool families](../reference/tools/index.md).
