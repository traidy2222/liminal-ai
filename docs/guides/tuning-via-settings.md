# Tuning via Settings (web)

Change harness behavior without editing `.env` for every flag.

## Open Settings

Web client → **Settings** modal. Fields mirror `HARNESS_SETTINGS_FIELD_META` in core (tabs: harness, session, memory, web, safety, models, …).

## What you can change

- Distill, tool body elide, lazy tool families
- Web fetch timeouts and readability
- Memory / vault / recall options
- Session greet, persona bootstrap, heartbeat surface
- Fast model slug (when not locked by env)

## What stays in `.env`

- API keys (`AGENT_API_KEY`, provider-specific keys)
- `AGENT_MODEL` / `AGENT_API_BASE_URL` when set in env (shown as locked in Settings)
- Machine paths: `AGENT_VAULT_PATH`, `AGENT_WORKSPACE_ROOT`, `PORT`

## Save behavior

- `PUT /api/settings` merges into `.agent_runtime_prefs.json`.
- Agent must be **idle** (not mid-turn); otherwise HTTP 409.
- Restart TUI/web after changes if the running process loaded prefs only at startup.

API details: [Web API](../reference/web-api.md). Precedence: [Configuration basics](../start/configuration-basics.md).

## Regenerating docs after code changes

If you add `AGENT_*` keys to `harness_env_inventory.ts` and field meta, run:

```bash
npm run docs:gen
```

See Contributing in the root README.
