# Configuration Reference

Use `.env.example` as canonical source. This document groups major flags by subsystem.

## Core

- `AGENT_RULE_RECALL` — set to `0` to disable the harness-injected **named rule recall** system message at ReAct round 2 (see [Harness protocol](./harness-protocol.md)). Default is on; disabling saves tokens but removes the extra R-* nudge batch.
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

## Safety and Approval

- `AGENT_SAFETY_JUDGE`
- `AGENT_SAFETY_JUDGE_MODEL`
- `AGENT_APPROVAL_TIMEOUT_MS`
- `AGENT_DESTRUCTIVE_GATE`

## Context and Compression

- `AGENT_RECALL_EVERY_N`
- `AGENT_DISTILL`
- `AGENT_TOOL_BODY_ELIDE`
- `AGENT_TOOL_ELIDE_MIN_CHARS`
- `AGENT_TOOL_ELIDE_KEEP_ROUNDS`
- `AGENT_COMPRESS_SEMANTIC=1` — when context fills and old rounds are compressed, calls the configured model to produce a causal narrative digest instead of raw tool-name one-liners. Preserves reasoning chain across very long sessions.
- `AGENT_PROTOCOL_INTENT_HINT` — session-wide protocol section filter. Values: `coding` | `knowledge` | `execution` | `introspection`. Suppresses irrelevant heavy sections (vault KB, markets, document engine, vision sidecar) to save 300–800 tokens per turn. Can also be set programmatically per-turn via `buildAdaptiveProtocolSuffix(toolNames, intent)`.

## Web and fetch

- `AGENT_WEB_FETCH_TIMEOUT_MS` — per-URL HTTP timeout (ms) for `web_fetch` and each page load inside `web_research`. Default `20000`; clamped between `3000` and `120000`.
- `AGENT_WEB_READABILITY` — set to `1` to run fetched HTML through JSDOM + Mozilla Readability and return main-article plain text when extraction succeeds (length and quality heuristics apply). When off, `web_fetch` strips tags with regex only.

### Web fetch and Readability (implementation detail)

Readability runs for **article extraction**, not pixel layout. Before JSDOM parses the document, author `<style>`, `<link rel="stylesheet">`, and `<script>` blocks are stripped from a copy of the HTML so inline CSS does not go through `rrweb-cssom` (which errors on nested or modern CSS-in-JS). A silent `VirtualConsole` avoids noisy `jsdomError` logs for residual parse issues.

For rendered pages, screenshots, or DOM after layout, use Playwright **`browser_open` / `browser_act`** (see tool family `browser`). See [Harness protocol](./harness-protocol.md#web-fetch-readability-and-jsdom) for the conceptual summary.

## Memory and Retrieval

- `AGENT_EMBED_MODEL`
- `AGENT_MEMORY_AUTO_EXTRACT`
- `AGENT_MEMORY_GRAPH`
- `AGENT_MEMORY_AUTOLINK`
- `AGENT_MEMORY_AUTOLINK_MODEL`
- `AGENT_QUERY_REWRITE`

## Vault

- `AGENT_VAULT_PATH`
- `AGENT_VAULT_AUTO_WRITE` (`off` | `research` | `aggressive`)
- `AGENT_VAULT_DEDUPE`
- `AGENT_VAULT_WRITE_BUDGET`
- `AGENT_VAULT_REQUIRE_LINKS`
- `AGENT_VAULT_OBSERVABILITY`
- `AGENT_VAULT_FIRST_STRICT`
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

- strict vault-first blocking is opt-in (`AGENT_VAULT_FIRST_STRICT=1`)
- default vault auto-write behavior is research-oriented unless explicitly disabled
- latest/current web queries are time-anchored to current year by tool normalization
- conversational self-management persists approved settings into `.agent_runtime_prefs.json`

## Recommended Baseline Profiles

### Stable local dev
- `AGENT_TOOL_LAZY=1`
- `AGENT_UI_VERBOSITY=normal`

### Safety-sensitive
- `AGENT_SAFETY_JUDGE=1`
- `AGENT_DESTRUCTIVE_GATE=balanced`
- `AGENT_APPROVAL_TIMEOUT_MS=120000`

### Research-heavy
- `AGENT_QUERY_REWRITE=1`
- `AGENT_EMBED_MODEL=openai/text-embedding-3-small`
- `AGENT_VAULT_AUTO_WRITE=research`

### Long-session / deep reasoning
- `AGENT_COMPRESS_SEMANTIC=1`
- `AGENT_REFLEXION_SEMANTIC=1` (default on)
- `AGENT_PROTOCOL_INTENT_HINT=coding` (adjust to task class)

### Plugin extensions
- `AGENT_PLUGIN_DIR=/path/to/plugins`

