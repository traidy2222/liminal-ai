# Persona bootstrap (first run)

First-run writing personality setup, separate from speech synthesis. Deep implementation: [Persona system](../concepts/persona-system.md).

## What happens

Desktop and web connect and verify a cloud or local model before this step. When
`AGENT_PERSONA_BOOTSTRAP` is on (default), choose a writing style or the built-in
personality. Optional spoken replies use the separately configured speech voice.

- **Custom prompt** — generation previews completed artifacts while staging them separately. A complete directory is promoted to `persona/active` only after success. Cancellation, timeout or provider failure preserves the old active files and permits retry. Interrupted directory promotion is recovered at startup.
- **Skip / default voice** — installs the bundled **Liminal** persona from `packages/tools/src/persona_default.ts` (profile, soul slices, HUD `ui_theme.json`, `ui_copy.json`). Reference copy: `persona/default/active/` in the repo. No LLM calls.

## Flags

| Variable | Purpose |
|----------|---------|
| `AGENT_PERSONA_BOOTSTRAP` | `0` skips bootstrap |
| `AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP` | `0` disallows skip |
| `AGENT_PERSONA_BOOTSTRAP_FORCE` | `1` or `--bootstrap` re-shows UI even if already completed |

## Web startup race

The web server can start without a configured provider so onboarding remains
reachable. Configuration loads independently of persona generation; bootstrap
submission waits for session initialization. Failure keeps the setup form open
with retry and built-in-personality options.

## After bootstrap

- Voice + soul slices load from `persona/active/`.
- Optional `persona/active/ui_theme.json` drives web/TUI chrome (`GET /api/config` → `personaUiTheme`).
- Adjust tone dials via `set_runtime_settings(persona_controls)` — not `remember`.

## Identity questions later

“Who are you?” should use **persona** (first system message), **harness** (Liminal runtime), and **base LLM** (model slug) as separate layers — see [Identity stack](../concepts/identity-stack.md).
