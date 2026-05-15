# Configuration Reference

> **Moved (narrative):** [Configuration basics](./start/configuration-basics.md) explains secrets vs Settings vs defaults.  
> **Full key list:** [Environment reference](./reference/environment.md) (generated from code).

This page groups major flags by subsystem for narrative browsing. **Precedence:** real `process.env` → `.agent_runtime_prefs.json` (`harness.env`) → [`harness_default_constants.ts`](../packages/core/src/harness_default_constants.ts). Put **secrets** in `.env` only; tune product flags via **Web Settings** (`GET`/`PUT /api/settings`) or prefs JSON.

## Core

- `AGENT_RULE_RECALL` — set to `0` to disable the harness-injected **named rule recall** system message at ReAct round 2 (see [Harness protocol](./concepts/harness-protocol.md)). Default is on; disabling saves tokens but removes the extra R-* nudge batch.
- `AGENT_API_KEY`
- `AGENT_API_BASE_URL`
- `AGENT_MODEL`
- `OPENROUTER_API_KEY`
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `XAI_API_KEY`
- `PORT`
- `AGENT_WORKSPACE_ROOT`
- `AGENT_TOOL_LAZY`
- `AGENT_UI_VERBOSITY`

## Persona and bootstrap

First-run and mid-session voice are controlled by the harness plus TUI/web clients.

- `AGENT_PERSONA_BOOTSTRAP` — set `0` to skip the model-injected first-run prompt asking how the assistant should sound (web/TUI + harness).
- `AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP` — set `0` to require persona bootstrap input (disables `skip` / `/skip` where supported).
- `AGENT_PERSONA_BOOTSTRAP_FORCE` — set `1` (or `npm run web -- --bootstrap` / `npm run tui -- --bootstrap`) to show the **persona bootstrap UI** (web modal or TUI overlay) even when first-run bootstrap is already marked complete in `.agent_runtime_prefs.json`. Use for demos or re-onboarding. **Normal first launch** does not need this flag: the web server finishes session initialization before accepting HTTP connections so the client sees accurate `personaBootstrapPending` from `/api/config`; the TUI reads the same prefs at startup.

**Generator tuning** (used by `persona_generator.ts` when `set_persona` runs a custom voice):

- `AGENT_PERSONA_INFER_MODEL` — optional model slug for persona inference steps; falls back to the harness fast-model helper when unset.
- `AGENT_PERSONA_GEN_TIMEOUT_MS` — per-request style timeout for persona HTTP calls (default `90000`, clamped up to `180000` ms).
- `AGENT_PERSONA_GEN_RETRIES` — retry budget for those calls (default `2`, max `3`).

**Persona UI theme** — no extra env. After a successful custom generation, `persona/active/ui_theme.json` holds a validated `PersonaUiThemeV1` (palette, label, motion). Web clients read it via `GET /api/config` (`personaUiTheme`, `personaDisplayLabel`); the TUI loads the same path at startup. See **[Persona system](./concepts/persona-system.md#ui-theme-clients)**.

Full pipeline, on-disk layout under `persona/active/`, and core APIs: **[Persona system](./concepts/persona-system.md)**.

## Safety and Approval

- `AGENT_SAFETY_JUDGE`
- `AGENT_SAFETY_JUDGE_MODEL`
- `AGENT_APPROVAL_TIMEOUT_MS`
- `AGENT_YOLO` — session-only destructive auto-approve switch (`1` to enable). Intended for launch-time usage (e.g. `npm run web -- --yolo`), not persistent safety posture.

## Context and Compression

- `AGENT_RECALL_EVERY_N`
- `AGENT_DISTILL`
- `AGENT_TOOL_BODY_ELIDE`
- `AGENT_TOOL_ELIDE_MIN_CHARS`
- `AGENT_TOOL_ELIDE_KEEP_ROUNDS`
- `AGENT_COMPRESS_SEMANTIC=1` — when context fills and old rounds are compressed, calls the configured model to produce a causal narrative digest instead of raw tool-name one-liners. Preserves reasoning chain across very long sessions.
- `AGENT_PROTOCOL_INTENT_HINT` — session-wide protocol section filter. Values: `coding` | `knowledge` | `execution` | `introspection`. Suppresses irrelevant heavy sections (vault KB, markets, document engine, vision sidecar) to save 300–800 tokens per turn. Can also be set programmatically per-turn via `buildAdaptiveProtocolSuffix(toolNames, intent)`.

## Web and fetch

- `AGENT_WEB_FETCH_TIMEOUT_MS` — per **attempt** budget (ms) for each GET: applies to the **full download** (headers plus body), not TTFB-only. Default `20000`; clamped between `3000` and `120000`.
- `AGENT_WEB_FETCH_TOTAL_WALL_MS` — **hard** wall clock (ms) for one `web_fetch` call (all attempts, body read, HTML/PDF parse). Default `55000`. Prevents long parallel fetches from stalling the UI for many minutes when retries stack.
- `AGENT_WEB_FETCH_RETRIES` — retries on 429/5xx or transient network errors. Default **`2`**; clamp `0–8`.
- `AGENT_WEB_FETCH_RETRY_MAX_DELAY_MS` — max backoff between retries for `web_fetch` (default `6000`; clamp `500–30000`). Keeps retry sleep from dominating wall time.
- `AGENT_WEB_FETCH_MAX_PREPROCESS_CHARS` — truncate HTML to this many characters before regex strip / Readability (default `400000`). Huge news pages otherwise stall JSDOM for minutes after download.
- `AGENT_WEB_FETCH_READABILITY_MS` — wall time cap (ms) for one JSDOM + Readability pass when `AGENT_WEB_READABILITY=1` (default `12000`; clamped `3000–25000`). On timeout, `web_fetch` falls back to regex-stripped HTML so the tool still completes within `AGENT_WEB_FETCH_TOTAL_WALL_MS`.
- `AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS` — **only this many characters** of HTML are passed to JSDOM/Readability (default `72000`; clamp `16000–250000`). Larger downloads are still truncated for regex fallback, but Readability never sees the full multi‑hundred‑KB document (which can block the Node event loop for many minutes, especially when several `web_fetch` calls run in parallel in one model round).
- `AGENT_WEB_READABILITY` — set to `1` to run fetched HTML through JSDOM + Mozilla Readability and return main-article plain text when extraction succeeds (length and quality heuristics apply). When off, `web_fetch` strips tags with regex only.
- `AGENT_WEB_FETCH_USER_AGENT` — override default Chrome-on-Windows User-Agent for `web_fetch` (and fallback reader fetch).
- `AGENT_WEB_FETCH_ALT_USER_AGENT` — User-Agent for the **one** optional 403/401 retry path (default Firefox-on-Windows string).
- `AGENT_WEB_FETCH_ACCEPT_LANGUAGE` — `Accept-Language` header (default `en-US,en;q=0.9`).
- `AGENT_WEB_FETCH_403_RETRY` — set to `0` to disable the alt-header retry when a 403/401 body looks like a CDN/bot interstitial. Default on (unset or any value except `0`).
- `AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE` — optional second fetch when the page URL returns 403/401. Template must contain `{url}` once; it is replaced with `encodeURIComponent(originalUrl)` (e.g. a self-hosted reader). Third-party readers have their own ToS, rate limits, and privacy implications—use at your own risk.

### Web fetch and Readability (implementation detail)

Readability runs for **article extraction**, not pixel layout. Before JSDOM parses the document, author `<style>`, `<link rel="stylesheet">`, and `<script>` blocks are stripped from a copy of the HTML so inline CSS does not go through `rrweb-cssom` (which errors on nested or modern CSS-in-JS). A silent `VirtualConsole` avoids noisy `jsdomError` logs for residual parse issues. HTML text decoding uses the response `Content-Type` charset when valid (falls back to UTF-8).

For rendered pages, screenshots, or DOM after layout, use Playwright **`browser_open` / `browser_act`** (see tool family `browser`). Document `GET`s use `Accept-Encoding: gzip, deflate, br` (not **zstd**) so fewer CDNs return zstd-compressed bodies that can surface as binary noise in plain-text extraction. See [Harness protocol](./concepts/harness-protocol.md#web-fetch-readability-and-jsdom) for the conceptual summary.

## Memory and Retrieval

**Background memory sync** (shown as **Memory sync** in the web Systems panel when enabled) periodically merges recent session traces into typed notes via the `remember` tool, so long-running work leaves fewer loose ends in `.agent_notes.json`. It runs only on the root agent after enough wall time and touched session files; it does not replace manual `remember` / `recall` during a turn. Turn it on with `AGENT_AUTO_DREAM=1` and tune cadence or scope with the variables below.

After a successful run, the harness may append a **short system message** (not a user turn) with the model’s consolidation summary so the chat log stays readable without making the next real user message look like a reply to that summary. Set **`AGENT_AUTO_DREAM_INJECT_TRANSCRIPT=0`** to skip that line entirely while still applying `remember` upserts from the same run.

- `AGENT_AUTO_DREAM` — set to `1` to enable background consolidation between turns (default off).
- `AGENT_AUTO_DREAM_INJECT_TRANSCRIPT` — `1` (default) appends the framed system summary; `0` disables transcript injection only.
- `AGENT_AUTO_DREAM_MIN_HOURS` — minimum hours since the last successful consolidation (default `24`).
- `AGENT_AUTO_DREAM_MIN_SESSIONS` — minimum session files touched since last run (default `5`).
- `AGENT_AUTO_DREAM_SCAN_INTERVAL_MS` — minimum milliseconds between scan attempts (default `600000`, ten minutes).
- `AGENT_AUTO_DREAM_MAX_SESSION_FILES` / `AGENT_AUTO_DREAM_MAX_CHARS_PER_SESSION` / `AGENT_AUTO_DREAM_MAX_TOTAL_CHARS` — caps on input size per run.
- `AGENT_AUTO_DREAM_LOCK_STALE_MS` — stale lock timeout for the consolidation lock file.
- `AGENT_AUTO_DREAM_ALLOW_DELETE` — set to `1` to allow the model to propose `forget` operations during consolidation (default off).

For **chit-chat / introspection** turns where you want less automatic memory priming (not the same as auto-dream), set **`AGENT_MEMORY_INTROSPECTION_STRICT=1`**—it tightens mid-turn recall policy when intent is classified as introspection.

### Personality heartbeat (idle ambient cognition)

After a **successful** root `turn_end(ok)`, the harness may schedule an idle debounced tick when **`AGENT_HEARTBEAT=1`**. The tick uses the **fast model** with a strict JSON contract, then may call `remember` via the dispatcher’s `directCall` path (no human approval). It **never** auto-runs shell, web, or other destructive tools. Each run appends a JSON line to **`.agent_heartbeat.jsonl`**. Telemetry is emitted as `heartbeat_*` events for the web/TUI Activity Stream and status strip. User-visible nudges are **rate-limited** and gated by **`AGENT_HEARTBEAT_SURFACE`** (`off` \| `trace` \| `assistant`, default `trace`). Set **`AGENT_HEARTBEAT_UI_STRIP=1`** to show the optional **Pulse** chip strip above the web composer when heartbeats are enabled.

- `AGENT_HEARTBEAT` — master switch (`1` on, unset or `0` off).
- `AGENT_HEARTBEAT_IDLE_MS` — debounce after turn end before the tick fires (default `45000`).
- `AGENT_HEARTBEAT_MIN_INTERVAL_MS` — minimum spacing between ticks (default `120000`).
- `AGENT_HEARTBEAT_MAX_TOKENS` / `AGENT_HEARTBEAT_TIMEOUT_MS` — cap LLM cost per tick (defaults `512` / `20000`).
- `AGENT_HEARTBEAT_SURFACE` — `off` \| `trace` \| `assistant` for optional `[Pulse]` trace lines vs a single **pulse nudge** row in the web transcript when confidence and hourly caps pass.
- `AGENT_HEARTBEAT_MAX_USER_NUDGES_PER_HOUR` — cap on surfaced nudges (default `2`).
- `AGENT_HEARTBEAT_USER_NUDGE_CONFIDENCE_MIN` — minimum model-reported confidence for a nudge (default `0.86`).
- `AGENT_HEARTBEAT_UI_STRIP` — `1` enables the optional web Pulse strip above the composer.

- `AGENT_EMBED_MODEL`
- `AGENT_MEMORY_AUTO_EXTRACT`
- `AGENT_MEMORY_GRAPH`
- `AGENT_MEMORY_AUTOLINK`
- `AGENT_MEMORY_AUTOLINK_MODEL`
- `AGENT_QUERY_REWRITE`
- `AGENT_MEMORY_EXPLORATORY_AUTO_RECALL` — set to `1` to allow a **tight** mid-turn memory prime on exploratory/creative turns (notes scope, excludes `trajectory` / `recipe`). Default off: exploratory turns skip auto `memory_query` / `recall_relevant` priming so answers are less likely to re-anchor to standing roadmaps.
- `AGENT_QUERY_REWRITE_EXPLORATORY` — set to `1` to run `rewriteQueryForRecall` on exploratory turns. Default off: skip multi-query expansion there so sub-queries are not nudged toward stored project vocabulary.

## Vault

- `AGENT_VAULT_PATH`
- `AGENT_VAULT_AUTO_WRITE` (`off` | `research` | `aggressive`)
- `AGENT_VAULT_DEDUPE`
- `AGENT_VAULT_WRITE_BUDGET`
- `AGENT_VAULT_REQUIRE_LINKS`
- `AGENT_VAULT_OBSERVABILITY`
- `AGENT_MEMORY_EPISODE`

## Critics and Reliability

- `AGENT_CRITIC`
- `AGENT_CRITIC_REQUIRE`
- `AGENT_CRITIC_EVIDENCE`
- `AGENT_CRITIC_MIN_TOOLS`
- `AGENT_FAILURE_LOG`
- `AGENT_REFLEXION_SEMANTIC` — defaults on. When all tools in a round fail, calls the model to extract a structured `{lesson, root_cause, fix_pattern}` JSON and stores it as a `reflection:` typed memory note. Set to `0` to revert to plain-text reflection.
- `AGENT_RATE_LIMIT_MAX_RETRIES`
- `AGENT_TRANSIENT_5XX_MAX_RETRIES`
- `AGENT_RETRY_MAX_DELAY_MS`

## Extensions

- `AGENT_PLUGIN_DIR` — absolute path to a directory of `.js` / `.mjs` plugin files. Each file must export `register(registry, emitter)`. Call `loadPlugins(registry, emitter)` at startup to load all plugins. Failed plugins emit an error event but do not prevent the harness from starting.

## Evaluation and Session Logging

- `AGENT_EVAL_JSON_SINK`
- `AGENT_SESSION_JSONL`
- `AGENT_SESSION_MODE`

## Behavior Notes

- default vault auto-write behavior is research-oriented unless explicitly disabled
- latest/current web queries are time-anchored to current year by tool normalization
- conversational self-management persists approved settings into `.agent_runtime_prefs.json`

## Recommended Baseline Profiles

Moved to [operations/profiles.md](./operations/profiles.md).

