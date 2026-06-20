# Vault briefs and updates

How to maintain situation-room style notes without orphans or wrong tools.

## Use vault ingest, not dumb writes

Notes live in the **Obsidian vault** (`AGENT_VAULT_PATH` or auto-discovered). They are **not** guaranteed to exist at `workspace/situation-room/...`.

| Task | Tool |
|------|------|
| Find a brief | `vault_search` |
| Read full note | `vault_read` with exact title |
| Single topic / dossier | **`vault_ingest`** (weaves bidirectional links) |
| Multi-entity research | **`vault_ingest_entities`** or parallel ingest per name |
| Raw URL / article | **`vault_ingest_source`** → `_liminal/raw/` + wiki fan-out |
| Legacy simple write | `vault_write` (delegates to ingest when tagged `liminal-agent`) |
| Wrong | `read_file` on guessed filesystem paths |

See [Memory and vault](../concepts/memory-and-vault.md) for path resolution and the safe zone (`_liminal/`, `liminal-agent` tag).

## Update an existing brief

1. `vault_search` or `vault_read` to load the current title and body.
2. **`vault_ingest`** with the **same title** — overwrites in place and refreshes graph links.

Dedupe (`AGENT_VAULT_DEDUPE=1`, default on) blocks near-duplicate *new* titles; reusing the exact title always updates.

## New edition vs merge

If content overlaps an older brief:

- **Option A:** Update in place via `vault_ingest` (same title).
- **Option B:** `vault_ingest` with a distinct title + `[[wikilink]]` to the prior note.
- **Option C:** Run `vault_lint fix:true` (agent zone only) to repair orphans after bulk ingest.

## Wikilinks and types

- Ingest auto-adds `## Related` outbound links and inbound links on up to 3 neighbors.
- Types: `entity`, `concept`, `source`, `synthesis`, `moc`, `fact`, `note`, …
- Tag agent writes with `liminal-agent` (added automatically on ingest).

## Write budget

`AGENT_VAULT_WRITE_BUDGET` limits vault ingest/write calls per `send()`. Prefer entity decomposition over monolithic dated blobs.

## One-shot cleanup

`vault_migrate_memory` — promote JSON memory → vault + backfill tags.  
`vault_curate` — idle lint fix, schema refresh, memory promotion.
