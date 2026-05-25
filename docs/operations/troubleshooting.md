# Troubleshooting

## Run `liminal doctor` first

From an install or cloned repo:

```bash
liminal doctor
# or
npm run doctor
```

Checks Node 22+, npm 10+, `.env` API key, `packages/core` and `packages/tools` builds, web client build (warn), and whether `PORT` (default 3001) is free. Fix hints are printed for each failure. Full install paths: [Install guide](../start/install.md).

## Recent fixes (operator-visible)

- **`vault_write` blocked updating same title** — fixed: same-title updates skip dedupe; use `ignore_dedupe: true` for new editions ([Vault briefs](../guides/vault-briefs-and-updates.md)).
- **`web_fetch` appearing stuck 5+ minutes** — hard wall `AGENT_WEB_FETCH_TOTAL_WALL_MS` (default 55s); readability in worker thread; rebuild `tools`.
- **Web “stuck processing”** — client uses `lastTurnEndedAt` + consecutive idle polls ([UI streaming](../concepts/ui-streaming.md)).
- **Persona bootstrap 500 on first load** — server gates API on session ready ([Persona bootstrap](../guides/persona-bootstrap.md)).
- **Large file ends mid-function or mid-tag** — `write_file` `mode: create` then `mode: append`; see [below](#file-ends-abruptly-incomplete-write).

## File ends abruptly (incomplete write) {#file-ends-abruptly-incomplete-write}

Symptom: Generated file stops mid-string, missing closing braces/tags, or far fewer lines than requested.

**Cause:** Provider **output token limit** or stream timeout — the model's tool `content` argument was cut off before completion. `write_file` writes whatever it received; `integrity=ok` only means disk matches that partial string.

**Fix:**

1. Rebuild `core` + `tools`, restart the UI.
2. **Multi-part workflow:** `write_file` with `mode: create` for the first section, then `write_file` with `mode: append` for each follow-up (or `edit_file` for small fixes). Verify with `file_metadata`.
3. Raise `AGENT_MAX_COMPLETION_TOKENS` if your provider route allows a higher cap.
4. Keep `AGENT_LENGTH_RESUME_MAX` at `3` (default) so truncated tool JSON auto-continues.

**Do not:** Call `write_file` with `mode: create` twice on the same path — the second call errors. Use `mode: append` or `edit_file`.

With `AGENT_WRITE_STREAM_SINK=1` (default), partial bytes may land on disk after a cutoff — read the `[CONTINUE]` message, then `write_file` `mode: append` to finish.

See [Harness protocol — Large file writes](../concepts/harness-protocol.md#large-file-writes).

## Build/Runtime Mismatch

Symptom: UI or tools do not match recent code.

```bash
npm run build -w packages/core
npm run build -w packages/tools
```

Restart TUI/web.

## Tool "not loaded for this session"

- `list_tool_families`
- `activate_tool_family` (e.g. `memory_advanced` for `read_artifact`)

## Vault path and dedupe

**Wrong location:** Set `AGENT_VAULT_PATH` or rely on [Obsidian discovery](../concepts/memory-and-vault.md#vault-path-resolution).

**`read_file` ENOENT on `situation-room/...`:** Notes are in the vault — use `vault_search` / `vault_read`.

**Near-duplicate on update:** Use the **same title** to overwrite, or `ignore_dedupe: true` for a deliberate new note — [Vault briefs](../guides/vault-briefs-and-updates.md).

## `read_artifact` hanging or useless

Requires **`AGENT_DISTILL=1`** or **`AGENT_TOOL_BODY_ELIDE=1`**. If both off, artifacts are not stored — use inline tool output.

When enabled: 25s wall per call, 12MB max file. Activate `memory_advanced` when lazy tools are on.

## `web_fetch` slow or failing

- Each call capped by **`AGENT_WEB_FETCH_TOTAL_WALL_MS`** (default 55s total)
- 403: bot-wall retries, fallback URL template, or `browser_*`
- Avoid many parallel fetches to slow news sites in one turn

Protocol: [Harness protocol — Web research](../concepts/harness-protocol.md#web-research-no-web_research-tool)

## `recall_relevant` and `max_results`

Schema uses **`k`**; **`max_results`** is accepted as an alias (same cap).

## Web stuck processing / SSE

See [UI streaming](../concepts/ui-streaming.md) and [Web API](../reference/web-api.md).

## TUI/Web streaming artifacts

1. Latest `core`/`tools`/client builds
2. Flush-before-structure ordering in reducers
3. Long-run smoke with heavy tool throughput

## Time drift in "Latest" searches

- World context active
- Web search temporal normalization
- Protocol time-anchor rules

## Excessive autonomy / missing approvals

- `AGENT_SAFETY_JUDGE=1`
- Check `AGENT_YOLO` / `--yolo` if approvals are skipped

## Repeated failure loops

- Duplicate-intent suppression in dispatcher
- Research anti-loop rules
- Drift/recovery events

## Double assistant reply on “who are you?”

Harness may skip secondary stream continuations — [Identity stack](../concepts/identity-stack.md).
