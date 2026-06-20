# Memory and Vault

Liminal uses two persistent channels:

- **Vault (primary brain)** — Obsidian-compatible markdown with wikilinks, MOCs, and entity dossiers
- **Typed JSON memory** — ephemeral/session scratch and fast recall (`remember`)

## Vault-primary brain (Karpathy LLM-Wiki pattern)

| Layer | Role |
|-------|------|
| `_liminal/raw/` | Immutable ingested sources (`vault_ingest_source`) |
| Wiki folders | Cross-linked dossiers (`vault_ingest`, `vault_ingest_entities`) |
| `_liminal/schema.md` | Living conventions for page types and lint rules |

**Safe zone (mixed personal vault):** agent auto-write, lint fix, and merge only touch notes tagged `liminal-agent` or paths under `AGENT_VAULT_AGENT_PREFIX` (default `_liminal`). Your manual notes are never auto-edited.

**Write path:** prefer `vault_ingest` / `vault_ingest_entities` / `vault_ingest_source` over raw `vault_write`. Ingest weaves bidirectional `[[wikilinks]]` (outbound + up to 3 inbound neighbor updates).

**Query path:** `vault_recall` neighborhood + `index.md` — not whole-vault RAG.

**Sleep phase:** `vault_curate` (idle) runs lint fix, promotes durable memory rows, refreshes schema. `auto_dream` and `consolidate_chat` also promote entity/fact upserts into the vault.

**Settings preset:** apply `OBSIDIAN_BRAIN_SAFE_ENV` from core (`AGENT_VAULT_DEDUPE=1`, `AGENT_VAULT_REQUIRE_LINKS=1`, `AGENT_VAULT_CURATE_ON_IDLE=1`, …).

## Typed Memory

`remember` supports typed entries:

- `fact`
- `entity`
- `experience`
- `belief`
- `reflection`
- `recipe`

Durable `entity`/`fact` rows are promoted into the vault by background consolidation. JSON memory shrinks to scratch/archive over time.

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

- `vault_ingest`, `vault_ingest_entities`, `vault_ingest_source` — connected writes (preferred)
- `vault_recall`, `vault_lint`, `vault_curate`, `vault_migrate_memory`
- `vault_search`, `vault_read`, `vault_write` (legacy/simple), `vault_list`, `vault_links`, `vault_graph`, `vault_delete`

Page types include `entity`, `concept`, `source`, `synthesis`, `moc`, plus `fact`, `note`, `episode`, etc.

### Vault path resolution

Order when `AGENT_VAULT_PATH` is unset:

1. **Explicit** `AGENT_VAULT_PATH` (normalized absolute path)
2. **Obsidian auto-discovery** — read global `obsidian.json`, pick an unambiguous vault (single entry, sole `open: true`, or latest `ts`) when `AGENT_OBSIDIAN_DISCOVER` is on (default)
3. Fallback **`~/.agent_vault`**

Use `AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING` when several vaults are registered. Set `AGENT_OBSIDIAN_DISCOVER=0` to skip Obsidian and use the fallback only. Set `AGENT_OBSIDIAN_REQUIRE_DOT_OBSIDIAN=0` to allow paths without a `.obsidian` folder.

### Vault vs workspace files

Rich briefs and wikilinked notes live in the **vault**, not under `AGENT_WORKSPACE_ROOT` tree paths like `situation-room/`. Use **`vault_search`** / **`vault_read`** / **`vault_ingest`** — not **`read_file`** on guessed workspace paths.

## Retrieval Order

Recommended order for factual tasks:

1. vault (`vault_recall`, `vault_search`)
2. memory (`recall_relevant`)
3. web

## Auto-Write Semantics

`AGENT_VAULT_AUTO_WRITE` modes:

- `off` (disabled)
- `research` (default): persist durable research-style learnings via `vault_ingest_entities` or `vault_ingest`
- `aggressive` (broader write behavior)

Defaults: `AGENT_VAULT_DEDUPE=1`, `AGENT_VAULT_REQUIRE_LINKS=1`, `AGENT_VAULT_ENTITY_EXTRACT=1`.

Deduplication skips auto-write when `vault_search` finds an existing note. Entity extraction splits multi-party research into per-entity dossiers with bidirectional links.

See [Vault briefs and updates](../guides/vault-briefs-and-updates.md).
