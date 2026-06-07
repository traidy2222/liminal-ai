# Liminal default persona bundle

Bundled persona installed when users **skip** bootstrap or choose **default voice** (`set_persona("default")`, `/default`, etc.).

**Source of truth (runtime):** `packages/tools/src/persona_default.ts` — `installDefaultPersonaArtifacts()` in `persona_runtime.ts` writes these files to `~/.liminal/persona/active/`.

The `active/` folder here is a **reference copy** of the on-disk layout for review and docs. Edit `persona_default.ts` first, then refresh this folder if you want them to stay in sync.

## Layout

| File | Purpose |
|------|---------|
| `runtime_profile.json` | Voice profile (name, tone, speech style, rails) |
| `ui_theme.json` | HUD shell, cyan accent, deep navy gradient |
| `ui_copy.json` | Composer labels, empty state, thinking text |
| `soul/*.md` | Identity, voice, stance, behavioral rails |
| `manifest.json` | Artifact index (written at install time; `updatedAt` varies) |

## Voice

**Liminal** — strength 6/10. Senior-engineer collaborative register: evidence-first, clear tradeoffs, calm confidence. Inspired by direct technical partners without theatrical roleplay.
