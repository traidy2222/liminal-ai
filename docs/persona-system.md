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
| **`persona_runtime.ts` (tools)** | Single orchestration surface: `parsePersonaInput`, `generatePersonaFromInput` (profile + soul artifacts + disk), `applyPersonaProfileToHarness`, `clearPersistedPersonaArtifacts`, reset keyword detection. |
| **`persona_generator.ts` (tools)** | LLM calls: structured **profile** JSON (`generatePersonaProfile`) then **soul** markdown + style lexicon JSON (`generatePersonaSoulArtifacts`). Progress callbacks for UIs. Env: `AGENT_PERSONA_INFER_MODEL`, `AGENT_PERSONA_GEN_TIMEOUT_MS`, `AGENT_PERSONA_GEN_RETRIES`. |
| **`persona_presets.ts` (tools)** | Types (`PersonaProfile`, `SpeechStyle`, `PersonaTone`), `buildRichPersonaBlock`, `buildPersonaVoiceSummary`, `buildPersonaTraitTags` — turns profile into the long system block and compact metadata for `PersonaConfig`. |
| **`set_persona.ts` (tools)** | Harness-scoped tool factory `createSetPersonaTool`: validates API key for generation paths, calls runtime helpers, updates persisted prefs on reset. |
| **`systemPrompt.ts` (tools)** | `buildPersonaBlock` merges configured/default persona into the protocol stack for TUI/web/eval. |

## User-facing entry points

### `set_persona` tool

- **`input`** — Natural-language voice description, **or** one of `default` / `reset` / `liminal` / `clear` to restore the default inception voice **without** an LLM call.
- **Strength** — Append `1`–`10` (e.g. `noir narrator 9`) or use `strength:6` in the string. Drives how strongly instructions are phrased in the generated profile (see `PersonaProfile` docstring in `persona_presets.ts`).
- **Modifier** — Append `but ...` to refine (e.g. `chipper coworker but less chatty`).
- **API key** — Custom generation requires provider access (tool checks `OPENROUTER_API_KEY` / harness config); reset path does not.

### First-run bootstrap (TUI / web)

Controlled by harness and bridge:

- **`AGENT_PERSONA_BOOTSTRAP`** — set `0` to skip the model-injected first-run “how should I sound?” user turn.
- **`AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP`** — set `0` to require an answer (disables `skip` / `/skip` shortcuts in clients that support them).
- **`AGENT_PERSONA_BOOTSTRAP_FORCE`** (web server) — set `1` to force bootstrap flow for testing.

On success, bootstrap completion is stored in runtime preferences so it does not repeat every session unless cleared.

## Workspace artifacts (`persona/active/`)

Under the resolved workspace root, generated custom personas persist for reuse and for building the richest possible system block:

| File | Role |
|------|------|
| `runtime_profile.json` | Serialized `PersonaProfile` (structured fields for identity, speech, tone, rails). |
| `soul.md` | Narrative “soul blueprint” — authoritative prose identity reference appended into the persona block. |
| `style_lexicon.json` | JSON lexicon appended as a second reference block. |
| `manifest.json` | Version, timestamps, source prompt snippet, file map. |

`applyPersonaProfileToHarness` loads `soul.md` and `style_lexicon.json` when present and concatenates them after `buildRichPersonaBlock(profile)` before calling `harness.setPersona`.

`clearPersistedPersonaArtifacts` removes the directory (used on explicit reset).

## Model pipeline (generation)

1. **Profile pass** — User phrase + strength + modifier → JSON-moded completion → `PersonaProfile` (validated shape: identity, speech, tone, cognition, `neverDo` / `alwaysDo`, optional `generationSourceHint` for surface-fidelity to user wording).
2. **Soul pass** — Profile + original user phrase → `soul.md` content + `style_lexicon` object (second completion pass).
3. **Persist** — Write all four artifacts; then **apply** to harness so the next model round sees the new block.

Timeouts and retries for the generator HTTP calls are bounded by `AGENT_PERSONA_GEN_TIMEOUT_MS` (default 90s, capped at 180s) and `AGENT_PERSONA_GEN_RETRIES` (default 2, capped at 3). Optional **`AGENT_PERSONA_INFER_MODEL`** overrides the model slug used for inference steps (falls back to fast model helper when unset).

## Core API surface (for tool authors)

From `AgentHarness` (see `packages/core/src/agent.ts`):

- **`setPersona(config: PersonaConfig, block: string)`** — Sets metadata + full markdown block in context (used after generation).
- **`resetPersona()`** — Restores inception identity from harness config; clears runtime override.
- **`patchRuntimePreferences({ persona: … }, { persist })`** — Partial updates for `bootstrapCompleted`, `sourcePrompt`, `activeProfile`, `updatedAt` (used by `set_persona` on reset and by flows that persist the active profile).

Child harnesses: `set_persona` is harness-scoped and listed with other orchestration tools so children do not get a stale copy of the parent tool registry; persona **inheritance** is via the parent’s applied context, not by duplicating the tool closure.

## Protocol interaction

`PROTOCOL_CORE` / named rules state that persona overrides conversational identity and that **first-system-message** profanity or sociolect should be matched in normal replies when compatible with safety (see `systemPrompt.ts`). That is orthogonal to **generated** personas from `set_persona`, but both compose into the same `PersonaConfig` + block channel.

## Troubleshooting

| Symptom | Check |
|---------|--------|
| “Cannot generate persona” | Provider key on harness; `OPENROUTER_API_KEY` or `AGENT_API_KEY` per your setup. |
| Persona resets every restart | `patchRuntimePreferences` / disk persistence failure; inspect `.agent_runtime_prefs.json` and `persona/active/` permissions. |
| Bootstrap loop | `AGENT_PERSONA_BOOTSTRAP`, client `skip` handling, and `isPersonaBootstrapCompleted()` state. |
| Weak voice adherence | Raise **strength**; ensure `soul.md` / lexicon generated (second pass succeeded); shorten conflicting instructions in user messages. |

## Related files (quick index)

- `packages/tools/src/set_persona.ts` — tool schema and handler.
- `packages/tools/src/persona_runtime.ts` — parse, generate, persist, apply, clear.
- `packages/tools/src/persona_generator.ts` — LLM profile + soul artifact builders.
- `packages/tools/src/persona_presets.ts` — types and block builders.
- `packages/core/src/agent.ts` — `setPersona`, `resetPersona`, bootstrap, prefs merge.
- `packages/core/src/runtime_prefs.ts` — `RuntimePersonaProfile` / `persona` preference shape.
- `packages/tools/src/systemPrompt.ts` — `buildPersonaBlock` for static config path.
- `packages/web/server/agentBridge.ts` — bootstrap force and session wiring.
- `packages/tui/src/useAgent.ts` — bootstrap and skip UX parity.

## Configuration summary

See [Configuration](./configuration.md#persona-and-bootstrap) for a copy-paste env list.
