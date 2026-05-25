# Configuration basics

Where Liminal reads settings, and what belongs in each place.

## Precedence (highest wins)

```text
process.env (shell / .env)
    ↓
.agent_runtime_prefs.json  →  harness.env { AGENT_*: "..." }
    ↓
packages/core/src/harness_default_constants.ts  (HARNESS_ENV_DEFAULTS)
```

Real environment variables always win. That lets CI and deploy inject secrets and overrides without editing JSON on disk.

## What goes where

| Store | Use for | Examples |
|-------|---------|----------|
| **`.env`** | Secrets and machine-specific paths | `AGENT_API_KEY`, `PORT`, `AGENT_VAULT_PATH` |
| **Web Settings** (`GET`/`PUT /api/settings`) | Non-secret product tuning | `AGENT_DISTILL`, `AGENT_TOOL_LAZY`, web_fetch timeouts |
| **`.agent_runtime_prefs.json`** | Persisted Settings + persona profile | `harness.env`, `persona`, bootstrap flags |
| **Typed defaults** | Fallback when unset | See [Environment reference](../reference/environment.md) |

Never commit API keys. Run `npm run verify-harness-defaults-no-secrets` in CI to ensure defaults files contain no obvious secrets.

## Web Settings workflow

1. Open the web client → **Settings**.
2. Fields are grouped by tab (session, memory, web, safety, models, …) from `harness_settings_field_meta.ts`.
3. Keys **locked by env** (set in `.env`) show as read-only — change `.env` and restart.
4. Save writes to `.agent_runtime_prefs.json`; restart TUI/web if a running process should reload prefs.

**What you can change in Settings:** distill, tool body elide, lazy tool families, web fetch timeouts and readability, memory/vault/recall options, session greet, persona bootstrap, heartbeat surface, fast model slug (when not env-locked).

**What stays in `.env`:** API keys, `AGENT_MODEL` / `AGENT_API_BASE_URL` when set there, `AGENT_VAULT_PATH`, `AGENT_WORKSPACE_ROOT`, `PORT`.

**Save behavior:** `PUT /api/settings` while the agent is **idle** (HTTP 409 if mid-turn). API details: [Web API](../reference/web-api.md).

## Narrative flag groups

Subsystem-oriented prose (persona bootstrap, web_fetch walls, heartbeat) remains in the [Configuration reference](../configuration.md) page. Prefer the generated [Environment reference](../reference/environment.md) for the complete key list.

## Recommended profiles

Preset combinations for common postures: [Baseline profiles](../operations/profiles.md).
