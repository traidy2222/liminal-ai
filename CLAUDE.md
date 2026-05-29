# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Build compiled packages (core + tools must be built before tui/web can run)
npm run build                          # all workspaces
npm run build -w packages/core         # core only
npm run build -w packages/tools        # tools only (requires core built first)

# Run the interfaces
npm run tui                            # terminal UI (ink/React)
npm run tui -- --bootstrap             # same + AGENT_PERSONA_BOOTSTRAP_FORCE (re-show TUI persona overlay)
npm run tui:bootstrap                  # alias for `npm run tui -- --bootstrap`
npm run web                            # build web client + Express (API + static UI on PORT, default :3001)
npm run web -- --bootstrap             # same + AGENT_PERSONA_BOOTSTRAP_FORCE (re-show web persona modal)
npm run web:dev                        # Express :3001 + Vite dev :3000 with hot reload
npm run web:dev -- --bootstrap         # web:dev + bootstrap force (or: npm run web:dev:bootstrap)

# Run the eval suite
npm run eval -w packages/eval                        # all scenarios
npm run eval -w packages/eval -- --only memory       # filter by name
npm run eval -w packages/eval -- --parallel 4        # parallel workers
npm run eval -w packages/eval -- --repeat 3          # repeat each scenario
npm run eval -w packages/eval -- --any-pass          # pass if any repetition passes

# Typecheck (no build output — fast CI check)
npm run typecheck                      # all workspaces
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc --noEmit -p packages/tools/tsconfig.json
npx tsc --noEmit -p packages/tui/tsconfig.json
npx tsc --noEmit -p packages/web/tsconfig.json

# After modifying core/src/*.ts, always rebuild before typechecking dependents:
npm run build -w packages/core && npx tsc --noEmit -p packages/tools/tsconfig.json

# Unit tests
npm run test                           # core unit tests (alias for the line below)
npm run test --workspace=@liminal/core # core: 28 test files (~120 cases)
npm run test -w packages/tools         # tools: web_fetch, persona, file, browser tests

# CI: ensure typed harness defaults contain no obvious secrets
npm run verify-harness-defaults-no-secrets

# Docs site (VitePress)
npm run docs:gen                       # regenerate docs/reference/environment.md from env inventory
npm run docs:check                     # validate docs links / structure
npm run docs:dev | docs:build | docs:preview

# Browser tools — one-time Playwright Chromium install
npm run browser:install
```

Verification: `npm run typecheck`, `npm run test`, and manual TUI/web runs.

## Environment variables

`.env` at the monorepo root. All `AGENT_*` vars are optional unless marked required.

**Where defaults live:** non-secret product defaults are typed in `packages/core/src/harness_default_constants.ts` (`HARNESS_ENV_DEFAULTS`), not generated from `.env`. Optional overrides without editing `.env` are persisted in `.agent_runtime_prefs.json` (local, gitignored — `harness.env` plus `provider` / `runtime` slices) and can be changed from the web **Settings** modal (`GET`/`PUT /api/settings`). **Precedence** per managed key: real `process.env` wins, then persisted prefs, then the typed defaults module. API keys stay in `.env` only. CI sanity check: `npm run verify-harness-defaults-no-secrets`.

The harness manages ~190 keys. The tables below are the curated subset that matters most when working in the repo; the **full generated list** is `docs/reference/environment.md` (`npm run docs:gen`). Secret keys (never persisted to prefs): `AGENT_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, `AGENT_VISION_API_KEY`, `AGENT_CAPTCHA_KEY`.

### Provider (key required)

| Var                  | Default                        | Purpose                                  |
| -------------------- | ------------------------------ | ---------------------------------------- |
| `AGENT_API_KEY`      | — (required)                   | OpenRouter (or provider) API key         |
| `AGENT_API_BASE_URL` | `https://openrouter.ai/api/v1` | Provider base URL                        |
| `AGENT_MODEL`        | `deepseek/deepseek-v4-pro`     | Main model slug — full ReAct loop        |

### Model routing

| Var                            | Default                        | Purpose                                                          |
| ------------------------------ | ------------------------------ | ---------------------------------------------------------------- |
| `AGENT_FAST_MODEL`             | `deepseek/deepseek-v4-flash`   | Small model: intent/distill/rewrite/critic/safety/auto-dream     |
| `AGENT_SAFETY_JUDGE_MODEL`     | `AGENT_FAST_MODEL`             | Classifier for safety judge (single-token 0/1)                   |
| `AGENT_EMBED_MODEL`            | `qwen/qwen3-embedding-8b`      | Embedding model for hybrid BM25+vector recall (`""` = BM25-only) |
| `AGENT_VISION_MODEL`           | `nvidia/nemotron-nano-12b-v2-vl:free` | Sidecar vision model for `vision_analyze`                  |
| `AGENT_VISION_BASE_URL` / `AGENT_VISION_API_KEY` | inherit provider | Vision provider URL / key                              |
| `AGENT_VISION_TIMEOUT_MS`      | `45000`                        | Vision call timeout                                              |
| `AGENT_VISION_MAX_IMAGE_BYTES` | `4194304`                      | Per-image size limit (4 MB)                                      |

Two-tier model: main model runs the full loop; fast model runs background JSON tasks. Sidecar model calls (`AGENT_RECALL_EVERY_N`, `AGENT_QUERY_REWRITE`, `AGENT_MEMORY_AUTO_EXTRACT`, `AGENT_SELF_HEAL_LINT`, `AGENT_SAFETY_JUDGE`) are **off by default** — each fires a full completion.

**Provider pinning + prompt caching** (defaults below). Both models pin to `DeepInfra` via `AGENT_PROVIDER_ORDER` / `AGENT_PROVIDER_ORDER_FAST` with `AGENT_PROVIDER_ALLOW_FALLBACKS=0`. Combined with `AGENT_PROMPT_CACHE=1` (adds `cache_control: ephemeral` on the trailing static system message), the ~14k-token PROTOCOL_CORE + named-rules prefix bills at the provider's cache-read rate (~$0.10/M on Pro vs $1.30/M cold = **13× discount**) on rounds 2+ of a ReAct turn. Drift across providers kills the cache, so fallbacks are intentionally off — set `AGENT_PROVIDER_ALLOW_FALLBACKS=1` only as an availability/quality tradeoff. Cache hit rate is logged per turn to the session JSONL trace as `[HARNESS] prompt_cache: cached=N/M (P%)`.

### Harness quality

| Var                         | Default | Purpose                                                                   |
| --------------------------- | ------- | ------------------------------------------------------------------------- |
| `AGENT_PROMPT_CACHE`        | on      | Add OpenRouter `cache_control: ephemeral` breakpoint on the static prefix — on DeepInfra/GMICloud/NovitaAI, cached prefix tokens cost ~1/10× normal on rounds 2+ |
| `AGENT_DISTILL`             | on      | Shrink huge tool outputs to artifact pointers in `.agent_artifacts/`. **Excludes `read_file` by default** — code is the model's substrate; distilling it forces re-reads. |
| `AGENT_DISTILL_READ_FILE`   | off     | Opt in to summarizing `read_file` outputs >25k chars. Off by default — enable only for summarization-heavy workflows, not coding. |
| `AGENT_TOOL_BODY_ELIDE`     | on      | Replace very large stale tool results with artifact pointers (`>12k` chars, keep last `AGENT_TOOL_ELIDE_KEEP_ROUNDS` rounds verbatim) |
| `AGENT_FAILURE_LOG`         | on      | Append-only failure log → `.agent_failures.jsonl` + `failure_review` tool |
| `AGENT_RULE_RECALL`         | on      | Harness rule injection at round 2 (set `0` to disable)                   |
| `AGENT_RECIPE_LIBRARY` / `AGENT_FAILURE_DIGEST` / `AGENT_GOLDEN_EVAL` | on | Success-recipe / failure-pattern / golden-eval telemetry |
| `AGENT_EVAL_JSON_SINK`      | on      | Log eval runs → `.agent_eval_runs/runs.jsonl` + summary JSON              |
| `AGENT_CRITIC`              | off     | Run `verify_result` when final answer is code/path-heavy                 |
| `AGENT_QUERY_REWRITE`       | off     | Multi-query expansion before `recall_relevant`                           |
| `AGENT_SPECULATIVE_READS`   | off     | Augment `read_file` with a few resolved relative imports                 |
| `AGENT_RECALL_EVERY_N`      | `0`     | Mid-turn `recall_relevant` priming every N rounds (`0` = off)            |
| `AGENT_UI_VERBOSITY`        | `normal`| `quiet` hides harness trace + provider retry lines                       |

### Reasoning & adaptive routing (Phase 1)

| Var                            | Default    | Purpose                                                              |
| ------------------------------ | ---------- | -------------------------------------------------------------------- |
| `AGENT_REASONING_BUDGET`       | on         | Infer per-turn reasoning effort / think-depth from the intent classifier |
| `AGENT_REASONING_DEFAULT_EFFORT` | `high`   | Fallback effort when the classifier is off / low-confidence          |
| `AGENT_REASONING_SURFACE`      | `external` | `native` \| `external` \| `auto` — external = model uses `think()` + `reason()` |
| `AGENT_EFFORT_LEARN`           | on         | Record per-intent effort outcomes; reuse the best as a prior         |
| `AGENT_INTENT_INFERENCE`       | on         | LLM-tier turn-intent classification (no regex fallback)              |
| `AGENT_INTENT_ROUTING`         | on         | Route knowledge/introspection turns to the fast model                |
| `AGENT_INTENT_FAST_THRESHOLD`  | `0.8`      | Min confidence to route to the fast model                            |

### Safety

| Var                         | Default  | Purpose                                                          |
| --------------------------- | -------- | ---------------------------------------------------------------- |
| `AGENT_SAFETY_JUDGE`        | off      | Heuristic + LLM pre-flight to skip human approval on safe tools  |
| `AGENT_APPROVAL_TIMEOUT_MS` | `120000` | Auto-reject after timeout (clamped 10s–600s)                     |
| `AGENT_YOLO`                | off      | Auto-approve all tools (`--yolo` flag) — trusted environments only |

### Context & session

| Var                                    | Default   | Purpose                                                               |
| -------------------------------------- | --------- | --------------------------------------------------------------------- |
| `AGENT_WORKSPACE_ROOT`                 | auto      | Root for world context, notes, artifacts, persona, tool path defaults |
| `AGENT_SEND_TIMEOUT_MS`                | `1800000` | Wall-clock cap for one full `send()` / ReAct run                      |
| `AGENT_CTX_HOT_ROUNDS` / `AGENT_CTX_WARM_ROUNDS` | `4` / `8` | Verbatim rounds kept / tier-2 provenance rounds            |
| `AGENT_SESSION_JSONL`                  | on        | Append-only event trace → `.agent_sessions/<taskId>.jsonl`            |
| `AGENT_SESSION_JSONL_TEXT_LOG`         | `rollup`  | `rollup` (one `text_rollup`/turn), `delta` (per-token), `both`        |
| `AGENT_SESSION_JSONL_TRACE`            | off       | Log `channel: "trace"` harness lines to JSONL (noisy)                |
| `AGENT_SELF_HEAL_LINT`                 | off       | Bounded post-edit lint self-heal loop in `AgentHarness`              |
| `AGENT_SELF_HEAL_MAX_PASSES`           | `4`       | Max diagnose→fix→verify passes per send                              |
| `AGENT_SELF_HEAL_LINT_MODE`            | `tsc`     | Self-heal lint mode (`tsc` \| `eslint` \| `command`)                 |
| `AGENT_LINT_ALLOWED_COMMANDS`          | empty     | Comma-separated allowlist for `run_lint` command mode                |

### Large-file writes

| Var                            | Default  | Purpose                                                                |
| ------------------------------ | -------- | ---------------------------------------------------------------------- |
| `AGENT_WRITE_STREAM_SINK`      | off      | Stream large `write_file`/`edit_file` content to `.agent_write_staging/` |
| `AGENT_WRITE_STREAM_SINK_MIN_CHARS` | `8000` | Min content size before the stream sink engages                     |
| `AGENT_WRITE_PART_MAX_CHARS`   | `512000` | Max chars per streamed write part                                      |
| `AGENT_LENGTH_RESUME_MAX`      | `3`      | Max resume attempts for a length-truncated write                       |
| `AGENT_WRITE_INTEGRITY_NUDGE`  | on       | Nudge the model when a written file looks truncated                    |
| `AGENT_MAX_COMPLETION_TOKENS`  | `4000`   | Per-completion token cap (drives length-resume chunking)               |

### Retry & rate limit

| Var                               | Default | Purpose                               |
| --------------------------------- | ------- | ------------------------------------- |
| `AGENT_RETRY_MAX_DELAY_MS`        | `30000` | Max exponential backoff               |
| `AGENT_RATE_LIMIT_MAX_RETRIES`    | `8`     | 429 retry budget                      |
| `AGENT_TRANSIENT_5XX_MAX_RETRIES` | `8`     | 5xx retry budget                      |
| `AGENT_RETRY_WALL_TIME_MS`        | `90000` | Max wall clock per send() retry block |
| `AGENT_PROVIDER_CIRCUIT_FAILURES` | `3`     | Failures before the provider circuit opens |

### Lazy tool loading

| Var                          | Default    | Purpose                                                                               |
| ---------------------------- | ---------- | ------------------------------------------------------------------------------------- |
| `AGENT_TOOL_LAZY`            | **on**     | Keep the OpenAI tool list minimal; load families on demand via `activate_tool_family` |
| `AGENT_ALWAYS_TOOLS_PROFILE` | `balanced` | Baseline family set when lazy. Options: `balanced`, `knowledge_first`, `max_autonomy` |

Troubleshooting inactive tools: (1) `list_tool_families` (pass `task_hint`), (2) `activate_tool_family` for one best-fit family, (3) retry the exact tool with corrected args.

### Memory & retrieval

| Var                           | Default           | Purpose                                                                       |
| ----------------------------- | ----------------- | ----------------------------------------------------------------------------- |
| `AGENT_MEMORY_GRAPH`          | on                | Link notes in a graph + enable the `memory_graph` tool                        |
| `AGENT_TRAJECTORY_WRITE`      | on                | Write causal-trajectory memory entries at turn end (zero LLM cost)            |
| `AGENT_MEMORY_AUTO_EXTRACT`   | off               | End-of-turn small completion that `directCall`s `remember`                    |
| `AGENT_MEMORY_AUTOLINK`       | off               | Suggest wikilinks after `remember` / `vault_write`                            |
| `AGENT_MEMORY_EPISODE`        | off               | Per-turn `vault_write` episode chunks                                         |
| `AGENT_VAULT_PATH`            | —                 | Explicit Obsidian vault folder (absolute); overrides auto-detect              |
| `AGENT_OBSIDIAN_DISCOVER`     | on                | Read Obsidian's `obsidian.json` when `AGENT_VAULT_PATH` is unset              |
| `AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING` | —         | Only vault paths containing this substring (case-insensitive) are candidates  |

**Vault resolution order** when `AGENT_VAULT_PATH` is unset: try Obsidian's registered vault list (`obsidian.json`) if discovery is on; pick a single vault when there is exactly one entry, exactly one with `open: true`, or a unique latest `ts`; otherwise fall back to `~/.agent_vault`. With several vaults and no clear signal, set `AGENT_VAULT_PATH` or `AGENT_OBSIDIAN_VAULT_NAME_SUBSTRING`.

### Auto-dream (background memory consolidation)

| Var                              | Default  | Purpose                                                            |
| -------------------------------- | -------- | ------------------------------------------------------------------ |
| `AGENT_AUTO_DREAM`               | off      | Background pass that consolidates session logs into memory/vault   |
| `AGENT_AUTO_DREAM_MIN_HOURS`     | `24`     | Min idle hours before a dream pass is eligible                     |
| `AGENT_AUTO_DREAM_MIN_SESSIONS`  | `5`      | Min unprocessed sessions before a dream pass triggers              |
| `AGENT_AUTO_DREAM_SCAN_INTERVAL_MS` | `600000` | How often the scanner checks for eligibility                    |
| `AGENT_AUTO_DREAM_ALLOW_DELETE`  | off      | Allow the dream pass to prune stale/contradicted notes             |
| `AGENT_DREAM_THRESHOLD`          | `0.15`   | Min BM25 score to trigger auto-recall                              |

The `auto_dream` delete path (when `AGENT_AUTO_DREAM_ALLOW_DELETE=1`) routes its deletes through the same curator safety-rails + soft-delete archive as `curate_memory` below.

### Memory curator (LLM prune + reversible soft-delete)

| Var                                  | Default | Purpose                                                                          |
| ------------------------------------ | ------- | -------------------------------------------------------------------------------- |
| `AGENT_MEMORY_ARCHIVE`               | on      | `forget`/`curate_memory` soft-delete to `notes.archive.json` before removing     |
| `AGENT_MEMORY_ARCHIVE_MAX`           | `2000`  | Archive ring-buffer cap (oldest rows trimmed past this)                          |
| `AGENT_MEMORY_CURATOR_MODEL`         | (fast)  | Optional model slug for `curate_memory` (empty = fast model)                     |
| `AGENT_CURATOR_TIMEOUT_MS`           | `90000` | Wall-clock budget for the `curate_memory` model call (clamped 5s–300s)           |
| `AGENT_CURATOR_MAX_TOKENS`           | `6000`  | Output budget for the curation plan JSON (clamped 1k–16k); guards against truncation |
| `AGENT_CURATOR_PROTECT_GLOBAL`       | off     | When on, also veto every `scope:global` note (off — global is the default scope) |
| `AGENT_CURATOR_PROTECT_ACCESS_COUNT` | `3`     | Never prune notes accessed ≥ this many times                                     |
| `AGENT_CURATOR_PROTECT_MIN_AGE_HOURS`| `24`    | Never prune notes younger than this (by `createdAt`)                             |
| `AGENT_MEMORY_MAX_NOTES`             | `0`     | Reserved: future budget-triggered auto-curation (`0` = off)                      |

`curate_memory({dry_run})` defaults to **dry-run** — it returns the LLM plan plus what the deterministic guardrail vetoed before anything is written. Pure planning/veto logic is in `core/memory_curator.ts`.

### Web & research

| Var                            | Default                   | Purpose                                                        |
| ------------------------------ | ------------------------- | -------------------------------------------------------------- |
| `AGENT_WEB_READABILITY`        | on                        | Article extraction (readability) in `web_fetch`                |
| `AGENT_WEB_FETCH_TIMEOUT_MS`   | `20000`                   | Per-request `web_fetch` timeout                                |
| `AGENT_WEB_FETCH_TOTAL_WALL_MS`| `55000`                   | Hard wall clock per `web_fetch` call (all retries + parse)     |
| `AGENT_WEB_FETCH_USER_AGENT`   | (Chrome 136 Win)          | Primary UA; Client Hints sent only if UA is Chrome-shaped      |
| `AGENT_WEB_FETCH_403_RETRY`    | on                        | Firefox + Chrome-cross-site retries after a bot-wall 401/403   |

Research on the public web uses **`web_search`** plus parallel **`web_fetch`** (no separate `web_research` tool). See [Research with web tools](docs/guides/research-with-web-tools.md).

### Browser & CAPTCHA

| Var                          | Default    | Purpose                                                            |
| ---------------------------- | ---------- | ------------------------------------------------------------------ |
| `AGENT_BROWSER`              | on         | Master switch for the headless-browser tool family                 |
| `AGENT_BROWSER_HEADED`       | off        | Run Chromium headed (visible) instead of headless                  |
| `AGENT_BROWSER_ALWAYS_ACTIVE`| off        | Keep the `browser` family loaded even under lazy loading           |
| `AGENT_BROWSER_STEALTH`      | on         | `addInitScript` fingerprint patches + disable AutomationControlled |
| `AGENT_BROWSER_MAX_SESSIONS` | `2`        | Concurrent browser sessions                                        |
| `AGENT_CAPTCHA_KEY`          | — (secret) | 2captcha / CapSolver API key (enables `captcha_solve`)             |
| `AGENT_CAPTCHA_SERVICE`      | `2captcha` | `2captcha` \| `capsolver`                                          |

### Markets

| Var                          | Default | Purpose                           |
| ---------------------------- | ------- | --------------------------------- |
| `AGENT_MARKETS_ENABLE`       | on      | Master switch for `markets_quote` |
| `AGENT_MARKETS_TIMEOUT_MS`   | `8000`  | Per-source fetch timeout          |
| `AGENT_MARKETS_RETRIES`      | `2`     | Retries per source                |

### Document engine

| Var                             | Default | Purpose                                                 |
| ------------------------------- | ------- | ------------------------------------------------------- |
| `AGENT_DOC_ENGINE`              | **on**  | Register all `doc_*` tools                              |
| `AGENT_DOC_AUTONOMY`            | on      | Auto-compose documents without explicit section prompts |
| `AGENT_DOC_WEB_ASSETS`          | on      | Fetch web images for slides/pages                       |
| `AGENT_DOC_QUALITY_MIN`         | `90`    | Minimum quality score (0–100) before export             |
| `AGENT_DOC_REPAIR_BUDGET`       | `4`     | Max lint-repair iterations per section                  |
| `AGENT_DOC_STYLE_DIVERSITY_MIN` | `0.12`  | Minimum style variance across sections                  |

### UI & persona

| Var                            | Default | Purpose                                                                                        |
| ------------------------------ | ------- | ---------------------------------------------------------------------------------------------- |
| `PORT`                         | `3001`  | Web server port                                                                                |
| `AGENT_SESSION_GREET`          | off     | Set `1` to enable the model's opening greeting on new sessions / after reset                   |
| `AGENT_PERSONA_BOOTSTRAP`      | on      | First-run modal asking how the assistant should sound                                          |
| `AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP` | on | Set `0` to require persona bootstrap input (disables skip)                                    |
| `AGENT_PERSONA_BOOTSTRAP_FORCE`| off     | Set `1` (or `npm run web/tui -- --bootstrap`) to re-show the persona UI even after first run   |
| `AGENT_PERSONA_GENERATION_STREAM` | on   | Stream persona artifacts incrementally during generation                                       |
| `AGENT_HEARTBEAT`              | off     | Personality heartbeat — idle-time autonomous ticks                                             |
| `AGENT_WEB_SKIP_CLIENT_BUILD`  | off     | Skip auto `vite build` when `client/dist` is missing (API-only placeholder at `/`)             |
| `AGENT_LOCATION`               | —       | Physical location string injected into world context                                          |

**Persona UI theme (no env):** after custom persona generation, `persona/active/ui_theme.json` stores a validated, presentation-only `PersonaUiTheme` (V1 or V2 — palette, `displayLabel`, `motion`, `shell`, density, typography). Web exposes it on `GET /api/config` as `personaUiTheme` / `personaDisplayLabel`; the TUI reads the same file at startup. It is data, not executable CSS/script — only whitelisted fields are mapped. See `docs/concepts/persona-system.md` and `packages/core/src/persona_ui_theme.ts`.

---

## Architecture

### Package dependency graph

```
packages/core       — compiled (dist/), no runtime deps except the openai SDK
     ↑
packages/tools      — compiled (dist/), depends on core
     ↑              ↑               ↑
packages/tui    packages/web    packages/eval   — run directly via tsx, never compiled
```

`core` and `tools` emit `dist/` via `tsc`. `tui`, `web`, and `eval` use `node --import tsx/esm` at runtime so they never need a build step themselves.

---

### `packages/core` — the harness engine (71 source files + 28 tests)

**Engine** — `agent.ts` (`AgentHarness`: the ReAct loop `runReActLoop`, retry/recovery, per-turn state, `forkChild()` for sub-agents), `dispatcher.ts` (`ToolDispatcher`: validate → danger pre-flight → lock → approval → handler; `directCall()` bypasses approval/locking), `context.ts` (`ContextManager`: history + tiered compression), `orchestrator.ts` (`ResourceLockManager` + `TaskOrchestrator`), `registry.ts` (`ToolRegistry` + lazy-load state), `events.ts` (`AgentEmitter`), `types.ts` (all shared interfaces), `streaming.ts` (`StreamAccumulator`).

**State & orchestration** — `epistemic_state.ts` (COMPASS-style subgoal snapshot), `execution_state.ts` (mission plans, contracts, drift scoring), `compensation_ledger.ts` (`CompensationLedger` — records/reverses partial side effects), `contract_tool_mapper.ts` (maps execution contracts → tool families), `tool_dag.ts` (`ToolDag` — intra-round dependency scheduling), `session_tool_index.ts` (`SessionToolIndex` — queryable tool-output index).

**Reasoning & routing** — `intent_inference.ts` (`TurnIntentClass`, routing profile), `reasoning_profile.ts` (per-turn reasoning budget / effort / think-depth), `reasoning_surface.ts` (native vs external surfacing), `reasoning_stream.ts` (reasoning stream state), `router.ts` (`getFastModelSlug`, `completeChatJson`), `query_rewrite.ts` (multi-query expansion).

**Memory & retrieval** — `memory_rank.ts` (BM25 + recency + type ranking, contradiction detection), `embeddings.ts` (OpenRouter embeddings), `shared_memory_bus.ts` (`SharedMemoryBus` — cross-agent facts), `fact_extractor.ts` (extract facts from tool output to the bus), `auto_dream.ts` (background memory consolidation — the project's namesake).

**File-write streaming** — `file_write_resume.ts` (resumable/eager dispatch logic for streamed writes), `file_write_stream_sink.ts` (`FileWriteStreamSink` — content → staging file), `file_write_stream_manifest.ts` (manifest for in-flight writes), `streaming_write_preview.ts` (live write preview), `tool_arg_content_stream.ts` (partial-JSON string-field parsing from tool-call deltas).

**Context & output** — `output_distill.ts` (large-output distillation + `.agent_artifacts/`), `token_estimate.ts` (`js-tiktoken`), `compression_guidelines.ts` (compression prompt guidance).

**World context** — `world_context.ts` (parallel environmental gatherers), `world_context_delta.ts` (`WorldContextRefresher` — cheap volatile-snapshot diffs), `platform_context.ts` (OS/shell/git/ports), `terminal_snapshot.ts` (external terminal snapshots), `repo_map.ts` (shallow repo tree).

**Harness config & settings** — `harness_rules.ts` (31 named rules injected at round 2), `harness_default_constants.ts` (`HARNESS_ENV_DEFAULTS`), `harness_effective_env.ts` (env precedence resolution), `harness_env_inventory.ts` (managed/secret key sets), `harness_settings_api.ts` / `harness_settings_field_meta.ts` / `harness_settings_sections.ts` (Settings UI metadata).

**Provider** — `provider_config.ts` (OpenRouter/OpenAI/Anthropic/xAI key resolution, routing), `provider_request_gate.ts` (request spacing / min-interval).

**Tool safety & validation** — `safety_judge.ts` (advisory classifier + LRU cache), `tool_arg_guard.ts` (deep JSON-schema validation), `tool_changed_paths.ts` (collect edited paths from edit/write tool args).

**Persona** — `persona_ui_theme.ts` (`PersonaUiThemeV1`/`V2`, validation, Ink/CSS mapping), `persona_bootstrap_progress.ts` (artifact progress events), `persona_bootstrap_ui_strings.ts`, `runtime_persona_controls.ts` (controls patch/apply), `personality_heartbeat.ts` (idle-time heartbeat).

**Learning & telemetry** — `recipe_library.ts` (recipe library — successful-strategy patterns keyed by `(intent class, tool-phase shape)` so similar turns compound; `.agent_recipe_stats.json`), `rule_stats.ts` (harness-rule hit + outcome stats), `outcome_scorer.ts` (per-turn outcome scoring + effort/intent stats), `trajectory_writer.ts` (causal trajectory logging), `failure_digest.ts`, `failure_log.ts` (`.agent_failures.jsonl`), `golden_eval.ts`, `session_event_log.ts` (`.agent_sessions/`).

**Utilities** — `runtime_prefs.ts` (`.agent_runtime_prefs.json`), `vault_path.ts` / `obsidian_vault_discovery.ts`, `workspace_root.ts`, `image_attachments.ts`, `input_semantics.ts`, `json_stable.ts`, `index.ts` (barrel export).

---

### `packages/tools` — tool implementations (114 source files + 6 tests)

`registerAllTools(registry, emitter, harness?)` in `index.ts` is the single registration point. Passing `harness` enables harness-scoped tool groups. With `AGENT_TOOL_LAZY` on (default), only the baseline profile registers up front; the rest activate on demand.

**Reasoning & planning** — `think`, `reason`, `plan`, `hypothesize`, `breakdown`.

**File read & navigation** — `read_file`, `read_file_chunked`, `read_file_with_imports`, `file_metadata`, `workspace_snapshot`, `grep_file` (content search), `find_files` (path/name glob, e.g. `**/*.test.ts`), `list_dir`, `repo_map`, `ast_grep`, `symbol_index`, `find_references`, `rename_symbol` (semantic TS/JS project-wide rename via the TS language service).

**File write** — `write_file` (whole-file: create/overwrite/append) and `edit_file` (targeted: `replacements` or fuzzy `diff`) are always loaded. The `files_edit` family (activation-only) adds `move_file`, `copy_file`, `copy_tree`, `mkdir_p`, `delete_file` (file or recursive dir; destructive, approval-gated), `multi_file_apply` (atomic, rollback-aware), `path_guard`. Streaming/integrity support: `file_write_ops.ts`, `file_write_integrity.ts`.

**Shell & process** — `run_shell` (`dangerLevel: "destructive"`), `run_background`, `kill_process`, `list_processes`, `read_process_output`, `run_command_with_pty`, `execute_code`, `run_tests`, `run_lint`.

**Web & markets** — `web_fetch`, `web_search`, `http_request`, `weather_lookup`, `markets_quote`.

**Browser** (`browser_runtime.ts` is the shared Playwright lifecycle) — `browser_open`, `browser_navigate`, `browser_snapshot`, `browser_act`, `browser_close`, `browser_serve_file`, `browser_wait_for`, `browser_extract`, `browser_cookies`, `captcha_solve`.

**Git** — `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit`, `git_checkpoint`, `git_rollback`, `git_worktree` (add/list/remove linked worktrees under `.agent_worktrees/`).

**Memory** (backed by `.agent_notes.json`) — `remember`, `recall`, `recall_type`, `forget`, `forget_type`, `memory_stats`, `search_memory`, `recall_relevant` (hybrid BM25 + embedding), `memory_query` (unified modes), `memory_graph`, `memory_consolidate`, `curate_memory` (LLM prune/merge/re-confidence with a deterministic safety-rail veto), `restore_memory` (recover from the soft-delete archive), `read_artifact`, `failure_review`. **Soft-delete:** `forget` and `curate_memory` archive the full `StoredNote` to `notes.archive.json` before removing (gated by `AGENT_MEMORY_ARCHIVE`, default on); `restore_memory` recovers it. The curator's veto + slice scoring live as pure functions in `core/memory_curator.ts` (shared with the `auto_dream` delete path); never prunes `user:`/`identity:`/`pref:` keys, high-access, or too-young notes. Identity protection is by **key prefix**, not by scope — `scope:"global"` is the auto-classifier's *fallback* (legacy / scratch-workspace / no-fingerprint writes), so it is curatable by default; set `AGENT_CURATOR_PROTECT_GLOBAL=1` to also shield global-scope notes.

**Vault** (Obsidian brain) — `vault_write`, `vault_read`, `vault_search`, `vault_list`, `vault_links`, `vault_graph`, `vault_delete`.

**Tasks & meta** — `task_checkpoint`, `resume_task`, `feature_checklist`, `suggest_improvement`, `view_insights`, `self_telemetry` (reports the harness's own failure/rule/recipe/effort telemetry), `agenda_set/get/clear`, `schedule_create/list/delete/run`, `breakout_start`, `pattern_record`, `independence_status`.

**Vision & images** — `vision_analyze`, `upload_image`.

**Document engine** (`AGENT_DOC_ENGINE` on by default) — `doc_plan` → `doc_research_brief` → `doc_collect_sources` → `doc_select_assets` → `doc_generate_chart_data` → `doc_compose_chunk` → `doc_lint_layout` → `doc_repair_chunk` → `doc_render_pptx`/`docx`/`pdf` → `doc_export` → `doc_quality_report`. Shared: `doc_engine.ts` (IR + manifest helpers), `doc_style_memory.ts`.

**Lazy loading & dynamic tools** — `list_tool_families`, `activate_tool_family` (`tool_activation.ts` + `tool_catalog.ts`); `create_tool`, `edit_tool`, `remove_tool`, `list_dynamic_tools` (`dynamic_tools.ts` — model-defined tools persisted to disk).

**Harness-scoped tools** (recreated per harness via `onChildCreated`, never copied parent→child):

| File               | Tools                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `orchestration.ts` | `spawn_agent`, `wait_for_agents`, `cancel_agent`, `list_agents`, `verify_result`, `evidence_critic`, `path_critic`, `policy_critic`, `reflect_debate` |
| `context_tools.ts` | `check_context`, `compress_context` (closes over a `ContextManager`)                                                                |
| `recall_compression.ts` | `recall_compression`                                                                                                          |
| `refresh_world_context.ts` | `refresh_world_context` (root-only)                                                                                         |
| `set_persona.ts` / `append_persona_living.ts` | `set_persona`, `append_persona_living`                                                          |
| `get_runtime_settings.ts` / `set_runtime_settings.ts` | `get_runtime_settings`, `set_runtime_settings`                                          |
| `upload_image.ts` / `hypothesize.ts` / `extract_structured.ts` | `upload_image`, `hypothesize`, `extract_structured`                            |
| `decompose_goal.ts` / `branch_explore.ts` / `verify_contract.ts` | goal decomposer, branch explorer, contract verifier                          |
| `synthesis_run.ts` | `synthesis_run` (cross-domain synthesis sub-agent)                                                                                  |
| `query_tool_outputs.ts` / `dispatch_graph.ts` / `branch_evaluate.ts` | session tool-output query, intra-round DAG scheduling, branch evaluation     |

**Memory key convention**: `"{type}:{key}"` (e.g. `reflection:abc123`). The harness auto-writes `reflection:` entries on all-tool-failure rounds. Successful multi-tool turns (≥4 tools, outcome ≥ 0.6) are recorded in the recipe library (`recipe_library.ts` → `.agent_recipe_stats.json`), keyed by `(intent class, tool-phase shape)` — not as `recipe:` memory notes.

**Cross-chat memory federation (Phase 2)** — every note carries a `scope` field with three values: `chat` (only the writing chatId sees it — hard ranker filter), `workspace` (every chat in the same `workspaceFingerprint` sees it; **default** for new writes), `global` (every chat sees it — durable identity facts). Auto-classifier in `defaultScopeForKey`: `user:*`/`identity:*`/`pref:*` → `global`, else `workspace` when a fingerprint resolves, else `global`. Same-workspace sibling-chat notes apply a multiplicative discount (default 0.85, env `AGENT_RECALL_SIBLING_DISCOUNT`) so the current chat's own writes win ties. `recall_relevant` surfaces provenance per line (`(own chat)`, `(sibling chat <id>)`, `(global)`) and exposes `workspace_scope: "current" | "all" | "global_only"`. The embedding index lives at user-global `~/.liminal/memory.index.json` (Phase 1 had a silent regression where it lived in scratch workspace roots). The vault gets a parallel semantic index at `~/.liminal/vault.index.json` via `vault_index.ts` so consolidated knowledge is paraphrase-findable. Three new tools: `memory_promote({key, to})` flips scope; `memory_neighbors({anchor_key|text, k})` returns k semantically-nearest notes via cosine; `consolidate_chat({chat_id?})` runs the auto-dream consolidator on demand against one chat's session.jsonl. Chat-id propagation rides AsyncLocalStorage in `chat_context.ts`, bound by `AgentHarness.send()`.

**Tool families** (`tool_catalog.ts`): `files_edit`, `shell`, `git`, `tasks`, `memory_advanced`, `web`, `markets`, `code_intel`, `browser`, `captcha`, `vision`, `audio`, `meta`, `reasoning_advanced` (harness-scoped: `decompose_goal`, `verify_contract`, `dispatch_graph`, `query_tool_outputs`, `research_state`), `dynamic_tools`, `external_api`, `vault`, `document`, `agenda_scheduler`, `synthesis`, `independence`, `navigation`, `harness_ui`, `orchestration` (now also `reflect_debate`, `branch_explore`, `branch_evaluate`). Every registered tool must belong to a family or the always-set — enforced by `tool_catalog.test.ts`.

**External API + MCP connections** (`api_connect.ts` / `mcp_attach.ts`). The meta tools `api_connect`, `api_disconnect`, `api_list`, `mcp_attach`, `mcp_detach` are always available. `api_connect` ingests an OpenAPI 3.x JSON spec and registers one tool per operation as `api_<conn>_<opSlug>` (GETs default to no-approval; writes always require approval). `mcp_attach` runs the MCP `initialize` → `tools/list` handshake against a Streamable-HTTP MCP server and registers each remote tool as `mcp_<conn>_<remoteName>`. Connection records persist as JSON under `~/.liminal/api_connections/<name>.json` and are re-registered on every `registerAllTools` call. Auth is stored by reference (env var name) — secrets are never persisted, resolved fresh on each request.

**Support modules** (not registered tools): `systemPrompt.ts` (`PROTOCOL_CORE` + `buildProtocolDynamicSuffix` — the authoritative system prompt), `persona_presets.ts` / `persona_runtime.ts` / `persona_generator.ts` / `persona_generator_stream.ts` / `persona_stream_extract.ts` / `persona_artifact_io.ts` / `persona_generation_preview.ts` (persona pipeline), `network_retry.ts`, `plugin_loader.ts`, `notes_store.ts` / `memory_index.ts` / `vault_store.ts`, `web_fetch_http.ts` / `web_fetch_readability_worker.ts`, `helpers.ts`.

Self-healing lint runtime: with `AGENT_SELF_HEAL_LINT=1`, `AgentHarness` tracks successful edit tools, runs `run_lint` in structured mode (changed-first scope, escalating to related files), prioritizes syntax/type errors, and emits `lint_heal_pass` / `lint_heal_result` telemetry.

---

### `packages/tui` — Ink terminal UI (29 files)

`src/index.tsx` creates the harness and calls `registerAllTools`. `useAgent.ts` manages all state via a reducer subscribed to `AgentEmitter` events.

**Components**: `App.tsx` (multiline input, image attachments, keyboard nav), `Header`, `StatusBar`, `Sidebar`, `MessageItem`, `InputLine`, `InputBox`, `ToolCallCard`, `ThinkCard`, `ReasonCard`, `BreakdownCard`, `PlanCard`, `SubtaskCard`, `TasksPanel`, `ApprovalModal`, `ApprovalPrompt`, `AskUserModal`, `AskUserPrompt`, `PersonaBootstrapModal`, `MemoryStrip`, `StreamingText`. Persona chrome via `personaChromeContext.tsx` + `theme/jarvis.ts`.

---

### `packages/web` — Express + React web UI (37 files)

**Server** (`server/`): `index.ts` (Express; PORT default 3001; serves `client/dist`, else `vite build`; SSE socket tuning), `agentBridge.ts` (owns the harness, bridges events to SSE), `sse.ts` (`SSEManager` — registry, history buffer, reconnect via `last-event-id`), `routes.ts` (`/api/config`, `/api/session/reset`, `/api/stream`, `/api/message`, `/api/approve`, `/api/answer`, `/api/settings`), `image_attachment_store.ts`.

**Client** (`client/`): `App.tsx` (chat UI, modals — approval / ask-user / persona bootstrap), `useSSE.ts` (SSE hook with reconnect + buffering), `useStickyAutoScroll.ts`, `StreamingWritePreviewBox.tsx`, `resolveToolCardsMode.ts`, `settings/` (`SettingsModal.tsx`, `providerPresets.ts`), and `persona/` — a shell system (`ShellRouter`, `ShellContract`, plus `TerminalShell` / `HudShell` / `StudioShell` / `MinimalShell`) driven by the persona UI theme, with `PersonaGenerationWorkbench` + `PersonaArtifactPanel` for live generation.

---

### `packages/eval` — evaluation suite (22 scenario packs)

CLI: `npm run eval -w packages/eval`. JSON sink: `AGENT_EVAL_JSON_SINK` (on by default) → `.agent_eval_runs/`.

`basic`, `reliability`, `harness_reliability`, `noise`, `memory_retrieval`, `retrieval_precision`, `harness_quality`, `harness_capability`, `epistemic_eval`, `multi_hop`, `contradiction`, `context_rot`, `approval_correctness`, `web_research_quality`, `research_grade`, `long_horizon`, `tool_lazy_load`, `large_file_write`, `reasoning_budget`, `browser_local`, `document_quality`, `document_autonomy`.

---

## Key invariants

**Build order matters.** `core` must be built before `tools`. Both must be built before `tui`/`web`/`eval` can typecheck (they import from `dist/`).

**Harness-scoped tools.** `ORCHESTRATION_TOOL_NAMES` in `agent.ts` lists every tool excluded from the parent→child registry copy in `forkChild()`. Any new tool that closes over a `harness` or `ContextManager` reference must be added to that set and wired in `onChildCreated` inside `orchestration.ts`.

**Destructive tools.** Tools with `dangerLevel: "destructive"` (`run_shell`, `run_background`) use the normal approval path when `requiresApproval` is true. There is no harness requirement to call `think()` or `plan()` first.

**Resource locks.** Tools declare `resourceLocks: (args) => string[]`. Lock IDs use prefixes `file:read:`, `file:write:`, `shell:`. `ResourceLockManager` always acquires in alphabetical order to prevent deadlock.

**Memory key conventions.** Typed notes use `"{type}:{key}"` storage keys. The harness auto-writes `reflection:` entries on all-tool-failure rounds. Successful multi-tool turns are recorded in the recipe library (`.agent_recipe_stats.json`), keyed by `(intent class, tool-phase shape)` and gated on outcome score — not as `recipe:` notes.

**No circular imports.** `core` has zero knowledge of `tools`. The `onChildCreated` hook on `AgentHarness` is how `tools/orchestration.ts` registers child-scoped tools without a circular dependency.

**File tools.** File content is exactly two always-loaded tools — `write_file` (create/overwrite/append) and `edit_file` (replacements/diff). The `files_edit` family is activation-only and holds filesystem ops plus `multi_file_apply` and `path_guard`. Legacy single-mode tools (`apply_diff`, `patch_file`, `search_replace_file`, etc.) were removed.

**Large-file writes.** When `AGENT_WRITE_STREAM_SINK` is on, big `write_file`/`edit_file` payloads stream as tool-call arg deltas into a staging file under `.agent_write_staging/`; `file_write_resume.ts` can resume a length-truncated write from a manifest instead of losing the turn. Write-back integrity verification guards against truncated content.

**Reasoning budget & surface.** Per-turn reasoning effort is inferred (`reasoning_profile.ts`) and the surface resolved (`reasoning_surface.ts`); default surface is `external`, so the model reasons via the `think()` + `reason()` tools rather than a native reasoning stream.

**Lazy tool loading.** `AGENT_TOOL_LAZY` is **on by default**. `activate_tool_family` calls `registerAllTools` for the requested family into the live registry; `tool_catalog.ts` tracks activated families — never activate the same family twice on one registry. Baseline set is chosen by `AGENT_ALWAYS_TOOLS_PROFILE`.

**Document engine IR.** `AGENT_DOC_ENGINE` is on by default. All `doc_*` tools communicate via `DocumentIR` + a manifest in `.agent_artifacts/`. The render tools are the only ones that emit final binary output; the quality gate (`AGENT_DOC_QUALITY_MIN`) is checked inside `doc_render_*` before export.

**Safety judge caching.** The safety judge uses an in-process LRU cache keyed on `(toolName, stableArgsJsonKey(args))` with a short TTL. Do not rely on cached verdicts surviving a harness restart.

**Epistemic + execution state.** Both are per-harness (not shared with child harnesses). `EpistemicState` tracks subgoals; `ExecutionState` tracks contracts and drift. Both are serialized into the `turn_end.workingStatePreview` event and rendered in TUI/web.

**Compensation ledger.** With `AGENT_COMPENSATION_ENABLED` on, partial plan side-effects are recorded and can be reversed on failure (`compensation_ledger.ts`).
