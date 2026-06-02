# Reasoning &amp; effort

Liminal separates **three independent dials** that are easy to confuse:

| Dial | What it controls | Keys |
| ---- | ---------------- | ---- |
| **Reasoning budget** | How deeply the model *deliberates* internally per turn | `AGENT_REASONING_*` |
| **Output effort** | How thorough the produced *deliverable* is | `AGENT_EFFORT` |
| **Model routing** | Which model runs the turn | `AGENT_INTENT_*`, `AGENT_FAST_MODEL` |

## Reasoning budget &amp; surface

Per-turn reasoning effort and think-depth are **inferred** from the intent classifier
(`AGENT_REASONING_BUDGET`, on). The **surface** decides *how* the model reasons:

- `external` (default) — the model reasons via the observable `think()` + `reason()` tools, so
  you can see its deliberation in the UI.
- `native` — use the provider's native reasoning stream.
- `auto` — pick per turn.

When the classifier is off or low-confidence, `AGENT_REASONING_DEFAULT_EFFORT` (`high`) applies.
`AGENT_EFFORT_LEARN` (on) records per-intent reasoning outcomes and reuses the best as a prior.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_REASONING_BUDGET` | on | Infer per-turn reasoning effort / think-depth |
| `AGENT_REASONING_SURFACE` | `external` | `native` \| `external` \| `auto` |
| `AGENT_REASONING_DEFAULT_EFFORT` | `high` | Fallback when classifier is off/low-confidence |
| `AGENT_EFFORT_LEARN` | on | Learn best reasoning effort per intent |

## Output effort

`AGENT_EFFORT` (`low` · `medium` · `high` · `xhigh`, default `medium`) is **not** reasoning —
it's how complete, edge-case-covered, and polished the *deliverable* is. It's injected each
turn as a system directive and scales completion `max_tokens` (≈0.75× low … 1.5× xhigh). The
named rule **R-EFFORT** ties model behavior to it; `high`/`xhigh` turns suspend the default
brevity rule unless you asked for something short.

Set it in **Settings** or `.env`. Raise it for thorough research/reports; lower it for quick
lookups.

## Model routing

A fast-model intent classifier (`AGENT_INTENT_INFERENCE`, on) labels each turn and can route
knowledge/introspection turns to the **fast model** (`AGENT_INTENT_ROUTING`) when confidence
clears `AGENT_INTENT_FAST_THRESHOLD`. The main model runs the full ReAct loop; the fast model
(`AGENT_FAST_MODEL`) handles classification, distillation, rewrites, critics, and other
background JSON tasks. See [Configuration](../configuration.md) for the model keys.

## Rule of thumb

- Quick factual or navigation turn → low effort, fast model is fine.
- Hard multi-step implementation → high reasoning, main model.
- Comprehensive report/deliverable → `AGENT_EFFORT=high`/`xhigh` (output), independent of
  reasoning depth.

These dials are also distinct from [workflows](./dynamic-workflows.md) (parallel fan-out).
