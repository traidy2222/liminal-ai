# Memory and Vault

Liminal uses two persistent channels:

- compact typed notes (`remember`)
- rich markdown knowledge (`vault_*`)

## Typed Memory

`remember` supports typed entries:

- `fact`
- `entity`
- `experience`
- `belief`
- `reflection`
- `recipe`

Retrieval tools include exact/type/lexical/hybrid/graph paths (`memory_query`, `recall_relevant`, etc.).

## Spaced-Repetition Decay

`recall_relevant` applies a spaced-repetition decay multiplier to every candidate score before ranking. The decay is based on `lastAccessedAt` (ISO timestamp of last retrieval) stored on each `StoredNote`.

Decay model:
- Curve: `0.5 ^ (daysSinceAccess / halfLife)` — default half-life is 30 days.
- Floor: `0.25` — old-but-valid notes are never fully suppressed.
- Ceiling: `1.0` — recently accessed notes are not boosted above their raw score.
- Access resistance: each past access adds +0.008 resistance (capped at +0.4 for 50 accesses), reflecting notes that have proven useful repeatedly.
- Never-accessed notes default to ~0.55 + confidence lift rather than full suppression.

The decay is computed by `spacedRepetitionDecay()` in `packages/core/src/memory_rank.ts` and applied as a final multiplier: `score = rawScore * decay`. This means stale notes naturally drop in rank over time without any manual curation.

## Vault Model

Vault tools manage Obsidian-compatible markdown with frontmatter and wikilinks:

- `vault_search`
- `vault_read`
- `vault_write`
- `vault_list`, `vault_links`, `vault_graph`, `vault_delete`

Set `AGENT_VAULT_PATH` to your real vault path to avoid writing to fallback locations.

## Retrieval Order

Recommended order for factual tasks:

1. memory
2. vault
3. web

These steps are **suggestions** only. The harness does not block `web_search` based on prior memory or vault calls.

## Auto-Write Semantics

`AGENT_VAULT_AUTO_WRITE` modes:

- `off` (disabled)
- `research` (default behavior when unset): persist durable research-style learnings
- `aggressive` (broader write behavior)

Deduplication is default-on unless `AGENT_VAULT_DEDUPE=0`.

## Growth vs Noise Tradeoff

Auto-write improves long-horizon knowledge reuse but can increase note churn. Use:

- dedupe
- write budgets
- note typing/tags
- periodic consolidation

to keep the vault high-signal.

## Operational Tips

- prefer durable facts and synthesis, not raw transcript dumps
- keep note titles canonical for linkability
- include uncertainty markers for rapidly changing topics
- keep manual curation loops for mission-critical domains