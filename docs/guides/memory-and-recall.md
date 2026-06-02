# Memory &amp; recall

Liminal's memory isn't a vector dump — it's **typed, ranked, scoped, curated, and
consolidated**. This guide is the practical how-to; for the data model and Obsidian details see
[Memory and vault](../concepts/memory-and-vault.md), and for vault writing habits see
[Vault briefs &amp; updates](./vault-briefs-and-updates.md).

## Two layers

| Layer | Store | For |
| ----- | ----- | --- |
| Structured notes | `.agent_notes.json` (keys like `fact:…`, `reflection:…`, `user:…`) | Atomic facts, decisions, preferences |
| Obsidian vault | Markdown under typed folders | Long-form, linked knowledge and briefs |

`recall_relevant` searches both by default. The protocol orders retrieval: memory / recall
first, then vault, then the web only if local knowledge is insufficient.

## Core tools

| Tool | Purpose |
| ---- | ------- |
| `remember` / `forget` | Write / soft-delete an atomic note (`forget` archives first) |
| `recall_relevant` | Hybrid BM25 + embedding recall across notes + vault (needs `query`/`queries`) |
| `memory_query` | Exact, type, or graph modes for structured lookups |
| `memory_graph` | Walk `links[]` / `supersedes` edges from a seed key |
| `memory_neighbors` | k semantically-nearest notes by cosine |
| `memory_consolidate` / `consolidate_chat` | Merge/condense; run the dream pass on one chat |
| `curate_memory` | LLM prune/merge with deterministic safety rails (dry-run by default) |
| `restore_memory` | Recover a soft-deleted note from the archive |
| `memory_promote` | Change a note's scope (`chat` → `workspace` → `global`) |

## How ranking works

`recall_relevant` fuses BM25, recency, note type, confidence, and access counts into tier
weights (hot / warm / cold). With `AGENT_EMBED_MODEL` set, embeddings are stored at
`~/.liminal/memory.index.json` (notes) and `~/.liminal/vault.index.json` (vault paragraphs),
and scores blend semantic + RRF + BM25 (`AGENT_RECALL_WEIGHTS`, default ≈ `0.45:0.35:0.20`).
Set an empty embed model for BM25-only.

## Cross-chat federation

Every note carries a **scope**:

| Scope | Visible to | Default for |
| ----- | ---------- | ----------- |
| `chat` | only the writing chat | — |
| `workspace` | every chat in the same workspace fingerprint | **new writes** |
| `global` | every chat | `user:`/`identity:`/`pref:` keys |

Sibling-chat notes get a multiplicative discount (`AGENT_RECALL_SIBLING_DISCOUNT`, default
`0.85`) so the current chat's own writes win ties. `recall_relevant` shows provenance per line
— `(own chat)`, `(sibling chat <id>)`, `(global)` — and `workspace_scope`
(`current | all | global_only`).

## Curation &amp; safety

`curate_memory({ dry_run: true })` (default) returns the LLM's prune/merge plan **plus** what
the deterministic guardrail vetoed. It never prunes `user:`/`identity:`/`pref:` keys,
high-access notes, or notes younger than `AGENT_CURATOR_PROTECT_MIN_AGE_HOURS`. Deletes route
through a soft-delete archive (`AGENT_MEMORY_ARCHIVE`, on) so `restore_memory` can recover them.

## What the harness writes automatically

- `AGENT_TRAJECTORY_WRITE` (on) — causal turn summaries at turn end, zero LLM cost.
- Reflections on all-tool-failure rounds (`reflection:` keys).
- Successful multi-tool turns feed the **recipe library** (`.agent_recipe_stats.json`), not
  spammy `recipe:` notes.
- `AGENT_AUTO_DREAM` (off) — idle-time consolidation of session logs into memory/vault.

## Key environment

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_EMBED_MODEL` | `qwen/qwen3-embedding-8b` | Embeddings for hybrid recall (`""` = BM25-only) |
| `AGENT_MEMORY_GRAPH` | on | Link notes + enable `memory_graph` |
| `AGENT_RECALL_SIBLING_DISCOUNT` | `0.85` | Sibling-chat ranking discount |
| `AGENT_MEMORY_ARCHIVE` | on | Soft-delete to archive before removal |
| `AGENT_AUTO_DREAM` | off | Background consolidation when idle |

Cloud sync of notes + vault across machines is a **Pro** feature — see
[Pro &amp; Enterprise](../reference/pro-and-enterprise.md).
