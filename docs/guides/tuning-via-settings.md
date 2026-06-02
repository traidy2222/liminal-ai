# Tuning via Settings

You can change most harness behavior **without editing `.env`**. The web **Settings** modal
writes to a local prefs file, and the harness resolves each managed key with a clear
precedence. This is the recommended way to experiment.

## Precedence (per managed key)

1. **Real `process.env`** (from `.env` or the shell) — always wins, and the key is shown as
   *locked* in Settings.
2. **Persisted prefs** — `.agent_runtime_prefs.json` (local, gitignored), written by Settings.
3. **Typed defaults** — `packages/core/src/harness_default_constants.ts` (`HARNESS_ENV_DEFAULTS`).

So to override a default, either set it in `.env` (permanent, locks the UI) or change it in
Settings (live, per-install). API keys stay in `.env` only and are never persisted to prefs.

## The Settings modal

Open the web UI → **Settings**. Fields are grouped into tabs generated from
`buildHarnessSettingsApiFields`. You can also set:

- **Provider** model slug + base URL (unless locked by `AGENT_MODEL` / `AGENT_API_BASE_URL`).
- **Inference mode** — `byok` · `managed` · `auto` (see [Managed inference](./managed-inference.md)).

Changes apply on the **next message** (the harness rejects a save mid-turn with HTTP 409).

## API

| Method | Path | Purpose |
| ------ | ---- | ------- |
| `GET` | `/api/settings` | Tabs + fields + provider summary (no API keys) |
| `PUT` | `/api/settings` | Patch `harness.env` and/or `provider` into prefs (**409** if busy) |

Locked keys (present in real `process.env`) can't be overridden via `PUT`. Full endpoint list:
[Web API](../reference/web-api.md).

## In the loop

The agent can read and adjust its own runtime settings with the harness-scoped
`get_runtime_settings` / `set_runtime_settings` tools (subject to the same precedence and
lock rules).

## Where to look things up

- Every managed key with its default: [Environment reference](../reference/environment.md)
  (generated — run `npm run docs:gen` after changing keys).
- Narrative grouping by subsystem: [Configuration](../configuration.md).
- Recommended bundles: [Baseline profiles](../operations/profiles.md)
  (`AGENT_ALWAYS_TOOLS_PROFILE`).
