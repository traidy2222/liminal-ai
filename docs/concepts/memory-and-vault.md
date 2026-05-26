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

### Vault path resolution

Order when `AGENT_VAULT_PATH` is unset:

1. **Explicit** `AGENT_VAULT_PATH` (normalized absolute path)
2. **Obsidian auto-discovery** — read global `obsidian.json`, pick an unambiguous vault (single entry, sole `open: true`, or latest `ts`) when `AGENT_OBSIDIAN_DISCOVER` is on (default)
3. Fallback **`~/.agent_vault`**

Use `AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING` when several vaults are registered. Set `AGENT_OBSIDIAN_DISCOVER=0` to skip Obsidian and use the fallback only. Set `AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN=0` to allow paths without a `.obsidian` folder.

### Vault vs workspace files

Rich briefs and wikilinked notes live in the **vault**, not under `AGENT_WORKSPACE_ROOT` tree paths like `situation-room/`. Use **`vault_search`** / **`vault_read`** / **`vault_write`** — not **`read_file`** on guessed workspace paths.

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

Deduplication is off by default; set `AGENT_VAULT_DEDUPE=1` to skip writes when body hash matches an existing note.

- **Update in place:** reuse the **exact same** `vault_write` title — dedupe is skipped when that title already exists.
- **New edition:** when content overlaps an older brief (e.g. Day 76 after Day 75), set **`ignore_dedupe: true`** on `vault_write`, or merge into the existing note instead of creating a parallel file.

See [Vault briefs and updates](../guides/vault-briefs-and-updates.md).

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