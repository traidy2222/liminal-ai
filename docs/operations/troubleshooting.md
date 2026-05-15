# Troubleshooting

## Recent fixes (operator-visible)

- **`vault_write` blocked updating same title** — fixed: same-title updates skip dedupe; use `ignore_dedupe: true` for new editions ([Vault briefs](../guides/vault-briefs-and-updates.md)).
- **`web_fetch` appearing stuck 5+ minutes** — hard wall `AGENT_WEB_FETCH_TOTAL_WALL_MS` (default 55s); readability in worker thread; rebuild `tools`.
- **Web “stuck processing”** — client uses `lastTurnEndedAt` + consecutive idle polls ([UI streaming](../concepts/ui-streaming.md)).
- **Persona bootstrap 500 on first load** — server gates API on session ready ([Persona bootstrap](../guides/persona-bootstrap.md)).

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

[Research with web tools](../guides/research-with-web-tools.md)

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
