# Persona system

This document describes the **end-to-end persona pipeline** in Liminal: how voice and identity are generated, persisted, injected into the model context, and reset. It is the reference for `set_persona`, bootstrap UX, and workspace artifacts.

## Goals and boundaries

- **Persona = tone, vocabulary, and identity presentation** — not a substitute for task instructions or tool policy. The system prompt still carries protocol, tools, and safety rails.
- **Hot-swap** — users can change voice mid-session via the `set_persona` tool without restarting the harness.
- **First-run bootstrap** — optional model-driven question flow so the user can steer voice early (TUI/web honor env flags below).

## Architecture (packages)

| Layer | Responsibility |
|--------|------------------|
| **`@liminal/core` (`AgentHarness`)** | Holds `currentPersona`, applies `setPersona(config, block)` into `ContextManager`, `resetPersona()`, persona bootstrap injection for new sessions, `patchRuntimePreferences` fields under `persona`, and `persona_changed` events. |
| **`persona_runtime.ts` (tools)** | Single orchestration surface: `parsePersonaInput`, `generatePersonaFromInput` (profile + multi-file soul + **UI theme** + disk), `loadPersonaUiThemeFromWorkspace`, `loadPersonaProfileFromWorkspace`, `applyPersonaProfileToHarness`, `appendPersonaLivingSection`, `clearPersistedPersonaArtifacts`, reset keyword detection. Stale `persona/active/soul.md` is **deleted** on load/persist (not migrated). |
| **`persona_generator.ts` (tools)** | LLM calls: structured **profile** JSON (`generatePersonaProfile`), multi-pass **soul slices** (`generatePersonaSoulArtifacts` → `PersonaSoulBundle`), then **UI theme** JSON (`generatePersonaUiTheme`, excerpt from canonical soul files). Progress callbacks for UIs. Env: `AGENT_PERSONA_INFER_MODEL`, `AGENT_PERSONA_GEN_TIMEOUT_MS`, `AGENT_PERSONA_GEN_RETRIES`. |
| **`persona_presets.ts` (tools)** | Types (`PersonaProfile`, `SpeechStyle`, `PersonaTone`), `buildRichPersonaBlock`, `buildPersonaVoiceSummary`, `buildPersonaTraitTags` — turns profile into the long system block and compact metadata for `PersonaConfig`. |
| **`set_persona.ts` (tools)** | Harness-scoped tool factory `createSetPersonaTool`: validates API key for generation paths, calls runtime helpers, updates persisted prefs on reset. |
| **`append_persona_living.ts` (tools)** | Harness-scoped `createAppendPersonaLivingTool`: bounded append to `soul/living.md` + reload persona block via `applyPersonaProfileToHarness`. |
| **`systemPrompt.ts` (tools)** | `buildPersonaBlock` merges configured/default persona into the protocol stack for TUI/web/eval. |

## User-facing entry points

### `set_persona` tool

- **`input`** — Natural-language voice description, **or** one of `default` / `reset` / `liminal` / `clear` to restore the default inception voice **without** an LLM call.
- **Strength** — Append `1`–`10` (e.g. `noir narrator 9`) or use `strength:6` in the string. Drives how strongly instructions are phrased in the generated profile (see `PersonaProfile` docstring in `persona_presets.ts`).
- **Modifier** — Append `but ...` to refine (e.g. `chipper coworker but less chatty`).
- **API key** — Custom generation requires provider access (tool checks `OPENROUTER_API_KEY` / harness config); reset path does not.

### `append_persona_living` tool

- **`note`** — Short markdown or plain text appended as a **timestamped section** to `persona/active/soul/living.md` (bounded per call and total file size; oldest head may be trimmed).
- **Reload** — After a successful append, the harness reloads the persona block from **`runtime_profile.json` on disk** and soul files (`activeProfile` in runtime prefs is preferred when present).
- **Not for user facts** — Use memory / vault for factual user or project knowledge; this file is **persona-local episodic** texture (voice habits, “what worked” for the character).

### First-run bootstrap (TUI / web)

Controlled by harness and bridge:

- **`AGENT_PERSONA_BOOTSTRAP`** — set `0` to skip the model-injected first-run “how should I sound?” user turn.
- **`AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP`** — set `0` to require an answer (disables `skip` / `/skip` shortcuts in clients that support them).
- **`AGENT_PERSONA_BOOTSTRAP_FORCE`** — set `1` (or `npm run web -- --bootstrap` / `npm run tui -- --bootstrap`) to **show the bootstrap UI even when** `persona.bootstrapCompleted` is already `true` in runtime prefs (testing or “run onboarding again”). It does **not** change normal first-time behavior: new installs already open the modal once `bootstrapCompleted` is unset. On **web**, the server waits for tool registration + `beginSession` before listening so `/api/config` reports the correct pending state. On **TUI**, startup checks prefs + this flag and shows a full-screen overlay instead of injecting a bootstrap chat turn.

On success, bootstrap completion is stored in runtime preferences so it does not repeat every session unless cleared.

## Workspace artifacts (`persona/active/`)

Under the resolved workspace root, generated custom personas persist for reuse and for building the richest possible system block. JSON and chrome stay at `persona/active/` root; narrative soul layers live under **`persona/active/soul/`**.

```text
persona/active/
  runtime_profile.json      # structured PersonaProfile (canonical)
  manifest.json             # version (2+), updatedAt, sourcePrompt, files map
  ui_theme.json             # presentation-only (existing pipeline)
  soul/
    identity.md             # who / stance toward user / self-image
    voice.md                # register, rhythm, example lines (descriptive)
    stance.md               # thinking + decision habits + relational posture
    rails.md                # prose echo of never/always + non-negotiables
    living.md               # harness-managed append-only (append_persona_living)
```

### Ownership (what may change, and how)

| Artifact | Primary author | Model / harness |
|----------|----------------|-----------------|
| `runtime_profile.json` | Bootstrap / `set_persona` generation | Should change only via validated paths (`set_persona`, `set_runtime_settings` for controls) — not raw `write_file`. |
| `soul/identity.md`, `voice.md`, `stance.md`, `rails.md` | Multi-pass LLM at generation + user edit in IDE | Overwritten on full regen; **not** for turn-by-turn append. |
| `soul/living.md` | **`append_persona_living` only** (recommended) | Append-only, timestamped sections; file tail retained when over cap. |
| `manifest.json` | Runtime / generator | Updated on persist. |
| `ui_theme.json` | `generatePersonaUiTheme` + core normalizer | Presentation-only; not model context. |

**Obsolete `persona/active/soul.md`:** If that monolithic file still exists from an older layout, the runtime **deletes it** whenever soul context is loaded or persona artifacts are persisted — canonical soul lives only under `soul/*.md`. It is **not** migrated into `identity.md`; run **`set_persona`** again if you need those words back (paste into your request or keep a manual copy before regenerating).

`applyPersonaProfileToHarness` reads the soul directory (after migration), concatenates **identity → voice → stance → rails** with HTML comment delimiters, then **`living.md` last** under an explicit **“PERSONA LIVING NOTES (session-accumulated; non-canonical)”** heading so supplemental material reads as less authoritative than canonical slices. It prepends `buildRichPersonaBlock(profile)` and calls `harness.setPersona`.

**Important:** Raw `write_file` on soul files does **not** refresh the in-memory persona block until something calls `applyPersonaProfileToHarness` again (e.g. `set_persona`, **`append_persona_living`** after its append).

Legacy `style_lexicon.json` files are still deleted on persona persist.

`clearPersistedPersonaArtifacts` removes the whole `persona/active/` tree (used on explicit reset).

## Model pipeline (generation)

1. **Profile pass** — User phrase + strength + modifier → JSON-moded completion → `PersonaProfile` (validated shape: identity, speech, tone, cognition, `neverDo` / `alwaysDo`, optional `generationSourceHint` for surface-fidelity to user wording).
2. **Soul pass** — Default **`AGENT_PERSONA_SOUL_MODE=batch`**: one fast-model JSON call returns all four markdown slices (`identityMd`, `voiceMd`, `stanceMd`, `railsMd`). Alternatives: `parallel` (four concurrent slice calls) or `scaffold` (no LLM — `buildSoulSlicesFromProfile` only). Soul HTTP uses **`personaInferModel()`** (`AGENT_PERSONA_INFER_MODEL` → `AGENT_FAST_MODEL` → main model). Per-slice scaffolds fill gaps when a slice fails validation.
3. **Persist** — Write profile, all soul slices, preserve or seed `living.md`, and manifest (`version: 2`); delete legacy `style_lexicon.json` if present; **apply** to harness so the next model round sees the new block.
4. **UI theme** — Runs **in parallel** with soul generation. Default: **`AGENT_PERSONA_UI_THEME_LLM=0`** — `derivePersonaShellHeuristics` + `validateAndNormalizePersonaUiTheme` only (no LLM). Set `AGENT_PERSONA_UI_THEME_LLM=1` for a small JSON theme completion using a profile + scaffold excerpt. Written to `ui_theme.json` (`v: 2`, manifest `uiThemeVersion: 2`). Legacy `v: 1` themes migrate on read.

**Typical LLM budget (balanced default):** voice infer + profile draft + up to **`AGENT_PERSONA_REPAIR_MAX`** repair (default `1`) + one batched soul call ≈ **3–4** round-trips (down from ~8–11 serial calls).

Progress stages for UIs include `artifact_start` (soul + theme), `ui_theme_start` / `ui_theme_ready` (see `persona_bootstrap_ui_strings` in core).

Timeouts and retries for persona HTTP calls: `AGENT_PERSONA_GEN_TIMEOUT_MS` (default 90s), `AGENT_PERSONA_GEN_RETRIES` (default 2). **`AGENT_PERSONA_INFER_MODEL`** overrides the fast sidecar slug for infer, soul batch, and optional theme LLM.

| Env | Default | Effect |
|-----|---------|--------|
| `AGENT_PERSONA_SOUL_MODE` | `batch` | `batch` \| `parallel` \| `scaffold` |
| `AGENT_PERSONA_UI_THEME_LLM` | `0` | `1` = LLM HUD theme; `0` = heuristics only |
| `AGENT_PERSONA_GENERATION_STREAM` | `1` | `0` = disable live bootstrap workbench (stage/message only) |
| `AGENT_PERSONA_PREVIEW_MAX_CHARS` | `16000` | Per-artifact SSE preview cap during bootstrap |

### Live bootstrap workbench (web + TUI)

When `AGENT_PERSONA_GENERATION_STREAM=1` (default), first-run bootstrap emits **six artifact panels** over SSE (`persona_bootstrap_progress` with an `artifacts` array): `runtime_profile.json`, four `soul/*.md` slices, and `ui_theme.json`. Content grows via **token streaming** from the provider (partial JSON extraction for batched soul; independent streams in `AGENT_PERSONA_SOUL_MODE=parallel`). Web shows a 2×3 grid workbench; TUI shows a compact status row plus a focus pane for the active stream. Files under `persona/active/` are written as each artifact completes (manifest + `living.md` last).
| `AGENT_PERSONA_REPAIR_MAX` | `1` | Profile repair passes (0–2) |

## UI theme (clients)

The theme artifact is **not** model context for the agent: it is a **trust-boundary-safe** contract consumed only by TUI and web chrome.

- **Schema** — `PersonaUiThemeV2` in `packages/core/src/persona_ui_theme.ts`: whitelisted hex fields, bounded `displayLabel`, discrete `motion` enum, plus presentation enums: `shell` (`hud` | `terminal` | `studio` | `minimal`), `density`, `radius`, `typography`, `messageStyle`, `orbStyle`, `background`, and optional `categoryTint` map. No raw CSS, HTML, or script — only values the runtime maps to CSS variables / Ink named colors and animation timing. Semantic tokens (`--lim-text`, `--lim-panel`, markdown headings, tool category colors) are **derived** in core via `derivePersonaSemanticTokens` and `themeToCssVars`.
- **Accessibility (web)** — Normalization boosts contrast of accent-like colors against a dark base (`surfaceTint` / `#020408`-class) so suggested palettes stay readable.
- **TUI** — `mapPersonaUiThemeToInk` maps hex suggestions to the nearest Ink **named** palette entries; `shell` is available for future layout hints (compact terminal-style messaging when `shell === "terminal"`). Core chrome avoids truecolor-only `Text` hex for portability (see `packages/tui/src/theme/jarvis.ts` tradeoff notes).
- **Web** — `GET /api/config` includes normalized `personaUiTheme` (v2, migrated from v1 on read) and `personaDisplayLabel`. `applyPersonaDocumentTheme` sets `:root` CSS variables, `data-persona-*` attributes, and orb motion keyframes. `ShellRouter` + `PersonaShellSwitcher` (`hud` / `terminal` / `studio` / `minimal`) apply shell-specific layout classes; shared components read `var(--lim-*)` via `personaVars.ts` and `categoryMeta.ts`.
- **Disk vs prefs** — Theme is **not** embedded in `.agent_runtime_prefs.json` by default; it is read from `persona/active/ui_theme.json` when present so prefs stay small.

## Core API surface (for tool authors)

From `AgentHarness` (see `packages/core/src/agent.ts`):

- **`setPersona(config: PersonaConfig, block: string)`** — Sets metadata + full markdown block in context (used after generation).
- **`resetPersona()`** — Restores inception identity from harness config; clears runtime override.
- **`patchRuntimePreferences({ persona: … }, { persist })`** — Partial updates for `bootstrapCompleted`, `sourcePrompt`, `activeProfile`, `updatedAt` (used by `set_persona` on reset and by flows that persist the active profile).

Child harnesses: `set_persona` and **`append_persona_living`** are harness-scoped and listed with other orchestration tools so children do not get a stale copy of the parent tool registry; persona **inheritance** is via the parent’s applied context, not by duplicating the tool closure.

## Protocol interaction

`PROTOCOL_CORE` / named rules state that persona overrides conversational identity and that **first-system-message** profanity or sociolect should be matched in normal replies when compatible with safety (see `systemPrompt.ts`). Rule **R-PERSONA-SOUL-WRITE** directs the model to use **`append_persona_living`** for durable persona-local learnings instead of rewriting soul files with `write_file`. That is orthogonal to **generated** personas from `set_persona`, but both compose into the same `PersonaConfig` + block channel.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “Cannot generate persona” | Provider key on harness; `OPENROUTER_API_KEY` or `AGENT_API_KEY` per your setup. |
| Persona resets every restart | `patchRuntimePreferences` / disk persistence failure; inspect `.agent_runtime_prefs.json` and `persona/active/` permissions. |
| Bootstrap loop | `AGENT_PERSONA_BOOTSTRAP`, client `skip` handling, and `isPersonaBootstrapCompleted()` state. |
| Web header still says "LIMINAL" / colors unchanged | `GET /api/config` — is `personaUiTheme` null? Regenerate persona or confirm `persona/active/ui_theme.json` exists after generation; reset/clear removes the directory. |
| Weak voice adherence | Raise **strength**; ensure soul slices under `soul/` exist after generation; shorten conflicting instructions in user messages. |

## Related files (quick index)

- `packages/tools/src/set_persona.ts` — tool schema and handler.
- `packages/tools/src/append_persona_living.ts` — append living soul + reload harness block.
- `packages/tools/src/persona_runtime.ts` — parse, generate, persist, apply, clear, migration, append helper.
- `packages/tools/src/persona_generator.ts` — LLM profile + soul artifact builders.
- `packages/tools/src/persona_presets.ts` — types and block builders.
- `packages/core/src/agent.ts` — `setPersona`, `resetPersona`, bootstrap, prefs merge.
- `packages/core/src/runtime_prefs.ts` — `RuntimePersonaProfile` / `persona` preference shape.
- `packages/core/src/persona_bootstrap_ui_strings.ts` — shared preset labels + stage hints (`@liminal/core/persona-bootstrap-ui` for web + TUI).
- `packages/tools/src/systemPrompt.ts` — `buildPersonaBlock` for static config path.
- `packages/web/server/agentBridge.ts` — bootstrap force and session wiring.
- `packages/web/server/routes.ts` — `GET /api/config` exposes `personaUiTheme` and `personaDisplayLabel` (loads theme via `loadPersonaUiThemeFromWorkspace`).
- `packages/web/client/applyPersonaDocumentTheme.ts` — maps theme to `:root` CSS variables and injects motion keyframes.
- `packages/core/src/persona_ui_theme.ts` — types, validation, Ink map, motion timing helpers.
- `packages/tui/src/personaChromeContext.tsx` — TUI chrome from theme + `StatusBar` spinner interval.
- `packages/tui/src/index.tsx` — startup: optional overlay instead of bootstrap chat turn + greeting sequencing.
- `packages/tui/src/components/PersonaBootstrapModal.tsx` — first-run overlay (presets, skip, progress).
- `packages/tui/src/useAgent.ts` — bootstrap state, `submitPersonaBootstrap`, skip parity with web.

## Configuration summary

See [Configuration](../configuration.md#persona-and-bootstrap) for a copy-paste env list.
