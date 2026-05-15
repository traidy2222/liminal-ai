# Persona bootstrap (first run)

Short guide for first-run voice setup. Deep implementation: [Persona system](../concepts/persona-system.md).

## What happens

When `AGENT_PERSONA_BOOTSTRAP` is on (default), web/TUI show a modal/overlay asking how the assistant should sound. The harness runs `persona_generator` pipelines, writes `persona/active/*`, and applies the profile to the live harness.

## Flags

| Variable | Purpose |
|----------|---------|
| `AGENT_PERSONA_BOOTSTRAP` | `0` skips bootstrap |
| `AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP` | `0` disallows skip |
| `AGENT_PERSONA_BOOTSTRAP_FORCE` | `1` or `--bootstrap` re-shows UI even if already completed |

## Web startup race

The web server waits for `bridge.whenSessionReady()` before `listen()` and gates `/api/config`, `/api/message`, and `/api/persona/bootstrap` on session init. If bootstrap POST returns 500 on first load, restart after a clean build — see [Troubleshooting](../operations/troubleshooting.md).

## After bootstrap

- Voice + soul slices load from `persona/active/`.
- Optional `persona/active/ui_theme.json` drives web/TUI chrome (`GET /api/config` → `personaUiTheme`).
- Adjust tone dials via `set_runtime_settings(persona_controls)` — not `remember`.

## Identity questions later

“Who are you?” should use **persona** (first system message), **harness** (Liminal runtime), and **base LLM** (model slug) as separate layers — see [Identity stack](../concepts/identity-stack.md).
