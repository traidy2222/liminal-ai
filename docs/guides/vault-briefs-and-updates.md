# Vault briefs and updates

How to maintain situation-room style notes without fighting dedupe or wrong tools.

## Use vault tools, not workspace paths

Notes live in the **Obsidian vault** (`AGENT_VAULT_PATH` or auto-discovered). They are **not** guaranteed to exist at `workspace/situation-room/...`.

| Task | Tool |
|------|------|
| Find a brief | `vault_search` |
| Read full note | `vault_read` with exact title |
| Create or update | `vault_write` |
| Wrong | `read_file` on guessed filesystem paths |

See [Memory and vault](../concepts/memory-and-vault.md) for path resolution.

## Update an existing brief (same day / revision)

1. `vault_search` or `vault_read` to load the current title and body.
2. `vault_write` with the **same title** as the existing note.

Dedupe is **skipped** when the title already exists, so you can replace the body in place.

## New dated edition (Day 76 after Day 75)

If content overlaps heavily and dedupe blocks a new file:

- **Option A:** `vault_write` with **`ignore_dedupe: true`** and a clearly distinct title (e.g. include the date).
- **Option B:** Update the existing note in place (same title) and bump the heading/date inside the body.
- **Option C:** Merge new intel into the prior note via wikilinks instead of parallel near-duplicates.

Error example: `Near-duplicate vault note detected: [[World Situation Brief — May 14 2026 (Day 75)]]` — follow one of the options above; do not retry the same title with overlapping body expecting a second file.

## Wikilinks and types

- Use `[[Note Title]]` in the body for graph connectivity.
- Set `type: note` (or `entity`, `fact`, etc.) and tags for search.
- Enable `AGENT_MEMORY_AUTOLINK=1` for optional link suggestions after write.

## Write budget

`AGENT_VAULT_WRITE_BUDGET` limits `vault_write` calls per `send()`. Consolidate into fewer, richer writes when hitting the cap.
