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
npm run web                            # Express server + Vite client on :3001/:5173

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
npm run test --workspace=@liminal/core    # tool arg guard, safety judge, memory rank, epistemic state, runtime prefs
```

Verification: `npm run typecheck`, `npm run test --workspace=@liminal/core`, and manual TUI/web runs.

## Environment variables

`.env` at the monorepo root. All `AGENT_*` vars are optional unless marked required.

### Provider (required)

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_API_KEY` | — | OpenRouter (or provider) API key |
| `AGENT_API_BASE_URL` | `https://openrouter.ai/api/v1` | Provider base URL |
| `AGENT_MODEL` | — | Model slug (e.g. `openrouter/owl-alpha`) |

### Model routing

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_FAST_MODEL` | `AGENT_MODEL` | Small model for distill / query rewrite / critic / auto-extract |
| `AGENT_SAFETY_JUDGE_MODEL` | `AGENT_MODEL` | Classifier for safety judge (single-token 0/1) |
| `AGENT_VISION_MODEL` | — | Separate vision model for `vision_analyze` sidecar |
| `AGENT_VISION_BASE_URL` | `AGENT_API_BASE_URL` | Vision provider URL |
| `AGENT_VISION_API_KEY` | `AGENT_API_KEY` | Vision provider key |
| `AGENT_VISION_TIMEOUT_MS` | `15000` | Vision call timeout |
| `AGENT_VISION_MAX_IMAGE_BYTES` | `4194304` | Per-image size limit (4 MB) |

### Harness quality

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_CRITIC=1` | off | Run `verify_result` when final answer is code/path-heavy |
| `AGENT_CRITIC_EVIDENCE=1` | off | Attach tool-output excerpts to the critic |
| `AGENT_DISTILL=1` | off | Shrink huge tool outputs to artifact pointers in `.agent_artifacts/` |
| `AGENT_QUERY_REWRITE=1` | off | Multi-query expansion before `recall_relevant` |
| `AGENT_SPECULATIVE_READS=1` | off | Augment `read_file` with a few resolved relative imports |
| `AGENT_RECALL_EVERY_N` | off | Mid-turn `recall_relevant` priming every N rounds |
| `AGENT_RULE_RECALL=0` | on | Disable harness rule injection at round 2 |
| `AGENT_FAILURE_LOG=1` | off | Append-only failure log → `.agent_failures.jsonl` + `failure_review` tool |
| `AGENT_EVAL_JSON_SINK=1` | off | Log eval runs → `.agent_eval_runs/runs.jsonl` + summary JSON |
| `AGENT_UI_VERBOSITY=quiet` | verbose | Hide harness trace + provider retry lines |

### Safety

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_SAFETY_JUDGE=1` | off | Heuristic + LLM pre-flight to skip human approval on safe tools |
| `AGENT_DESTRUCTIVE_GATE=balanced` | `strict` | Allow `plan()` to satisfy danger pre-flight (strict requires `think()`) |
| `AGENT_APPROVAL_TIMEOUT_MS` | `120000` | Auto-reject after timeout (clamped 10s–600s) |

### Context & session

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_WORKSPACE_ROOT` | auto | Monorepo root for world context, notes, artifacts, tool path defaults |
| `AGENT_SEND_TIMEOUT_MS` | `600000` | Wall-clock cap for one full `send()` / ReAct run |
| `AGENT_SESSION_JSONL=1` | off | Append-only event trace → `.agent_sessions/<taskId>.jsonl` |
| `AGENT_TOOL_BODY_ELIDE=1` | off | Replace huge tool results with artifact pointers |

### Retry & rate limit

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_RETRY_MAX_DELAY_MS` | `30000` | Max exponential backoff |
| `AGENT_RATE_LIMIT_MAX_RETRIES` | `8` | 429 retry budget |
| `AGENT_TRANSIENT_5XX_MAX_RETRIES` | `8` | 5xx retry budget |
| `AGENT_RETRY_WALL_TIME_MS` | `90000` | Max wall clock per send() retry block |

### Lazy tool loading

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_TOOL_LAZY=1` | off | Keep OpenAI tool list minimal; load families on demand via `activate_tool_family` |
| `AGENT_ALWAYS_TOOLS_PROFILE` | `balanced` | Baseline family set when lazy. Options: `balanced`, `knowledge_first`, `max_autonomy` |

Troubleshooting quick path for inactive tools:
1. `list_tool_families` (pass `task_hint` if useful),
2. activate one best-fit family with `activate_tool_family`,
3. retry the exact tool with corrected args.

### Memory & retrieval

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_EMBED_MODEL` | off | Embedding model for hybrid BM25+vector `recall_relevant` and world-context priming |
| `AGENT_MEMORY_AUTO_EXTRACT=1` | off | Run one small completion at turn end and `directCall` `remember` for extractions |
| `AGENT_MEMORY_EPISODE=0` | on (if vault set) | Disable per-turn `vault_write` episode chunks |
| `AGENT_MEMORY_AUTOLINK=1` | off | Suggest wikilinks after `remember` / `vault_write` |
| `AGENT_MEMORY_GRAPH=1` | off | Link notes in a graph + enable `memory_graph` tool |
| `AGENT_VAULT_PATH` | `~/.agent_vault` | Obsidian vault folder (absolute path) |

### Web & research

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_WEB_READABILITY=1` | off | Article extraction (readability) in `web_fetch` |
| `AGENT_WEB_RESEARCH=1` | off | Enable `web_research` tool (multi-query + dedup + readability) |

### Markets

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_MARKETS_ENABLE` | on | Master switch for `markets_quote` |
| `AGENT_MARKETS_TIMEOUT_MS` | `8000` | Per-source fetch timeout |
| `AGENT_MARKETS_RETRIES` | `2` | Retries per source |
| `AGENT_MARKETS_MAX_DELAY_MS` | `2000` | Max jitter between retries |

### Document engine

| Var | Default | Purpose |
|-----|---------|---------|
| `AGENT_DOC_ENGINE=1` | off | Enable all `doc_*` tools |
| `AGENT_DOC_AUTONOMY=1` | off | Auto-compose documents without explicit section prompts |
| `AGENT_DOC_WEB_ASSETS=1` | off | Fetch web images for slides/pages |
| `AGENT_DOC_QUALITY_MIN` | `90` | Minimum quality score (0–100) before export |
| `AGENT_DOC_REPAIR_BUDGET` | `4` | Max lint-repair iterations per section |
| `AGENT_DOC_MAX_SOURCE_LOOKUPS` | `24` | Max web fetches during research phase |
| `AGENT_DOC_STYLE_DIVERSITY_MIN` | `0.12` | Minimum style variance across sections |

### UI

| Var | Default | Purpose |
|-----|---------|---------|
| `PORT` | `3001` | Web server port |
| `AGENT_TUI_MEMORY_BULLETS` | — | Pipe-separated memory notes shown in TUI memory strip |
| `AGENT_LOCATION` | — | Physical location string injected into world context |

---

## Architecture

### Package dependency graph

```
packages/core       — compiled (dist/), no runtime deps except openai SDK
     ↑
packages/tools      — compiled (dist/), depends on core
     ↑              ↑               ↑
packages/tui    packages/web    packages/eval   — run directly via tsx, never compiled
```

`core` and `tools` emit `dist/` via `tsc`. `tui`, `web`, and `eval` use `node --import tsx/esm` at runtime so they never need a build step themselves.

---

### `packages/core` — the harness engine (42 files)

| File | Role |
|------|------|
| `agent.ts` | `AgentHarness` — main class. Owns the ReAct loop (`runReActLoop`), retry logic, error recovery injection, per-turn state (tool error counts, context alerts, recipe recording). `forkChild()` spawns scoped child harnesses for parallel sub-agents. |
| `dispatcher.ts` | `ToolDispatcher` — executes a single tool call: schema validation → danger pre-flight → resource lock → approval gate → handler → unlock. `directCall()` bypasses approval/locking for internal housekeeping. |
| `context.ts` | `ContextManager` — conversation history + ACON-lite compression. When token usage exceeds `thresholdFraction`, collapses old rounds into a structured summary block. `forceCompress(summary)` is the manual trigger. |
| `orchestrator.ts` | `ResourceLockManager` (alphabetical lock ordering, TTL eviction, 50ms polling) + `TaskOrchestrator` (task registry with complete/fail/cancel). Shared across all agents in a tree. |
| `registry.ts` | `ToolRegistry` — simple Map with `register/get/getAll/has/toOpenAIFormat`. |
| `events.ts` | `AgentEmitter` — typed wrapper around Node `EventEmitter`. Events: `text`, `tool_start`, `tool_delta`, `tool_approval`, `tool_result`, `ask_user`, `turn_end`, `error`, `subtask_spawned`, `subtask_complete`. |
| `types.ts` | All shared interfaces. `ToolDefinition` includes `resourceLocks?` and `dangerLevel?` fields. `AgentConfig` carries orchestration depth/concurrency limits. |
| `epistemicstate.ts` | COMPASS-style bounded task snapshot. Subgoals with status (`todo/doing/done/blocked`). Functions: `subgoalsFromPlanSteps()`, `markEpistemicPlanStepDone()`, `mergeExtractedSubgoals()`, `emptyEpistemicState()`, `mergeEpistemicState()`. Rendered in `[WORKING STATE]` block each turn. |
| `execution_state.ts` | Mission plans, milestones, execution contracts, recovery records, drift scoring. Functions: `createDefaultExecutionState()`, `advanceExecutionStateForPlan()`, `markExecutionContractStatus()`, `appendRecoveryRecord()`, `updateDriftScore()`. |
| `output_distill.ts` | Large tool-output distillation → structured summary + artifact pointer. Hash-based storage under `.agent_artifacts/`. Functions: `writeArtifact()`, `readArtifactText()`, `stashToolBodyElide()`. |
| `intent_inference.ts` | Turn intent classification. `TurnIntentClass = "introspection" \| "knowledge" \| "coding" \| "execution"`. Fallback regex + optional LLM tier. |
| `world_context.ts` | Dynamic environmental grounding (OS, shell, CWD, git, ports, resources, project info, tools, style, memory prefetch). 8 gatherers in parallel with individual timeouts; graceful degradation. |
| `recipe_library.ts` | Voyager-style success tracking. Persists counters to `.agent_recipe_stats.json`. Functions: `bumpRecipePattern()`, `formatRecipeLibraryHints()`. Hints surfaced in world context. |
| `memory_rank.ts` | BM25 + recency + type-based ranking for memory documents. Functions: `rankDocumentsForQuery()`, `memoryTypeBoost()`, `recencyBoost()`, `trustBoost()`. |
| `embeddings.ts` | OpenRouter embeddings client. Functions: `fetchEmbeddings()`, `cosineSimilarity()`. |
| `safety_judge.ts` | Advisory safety classifier: heuristics + optional single-token LLM (0/1) to skip human approval on clearly safe tool calls. Hardcoded shell ALLOW_PATTERNS. In-process cache with TTL. Verdict: `"safe" \| "require_human"`. |
| `tool_arg_guard.ts` | Deep JSON schema validation (type, enum, numeric range, string length, array items, nested objects). `guardToolArgs()` called by `dispatcher.ts` before invocation. |
| `streaming.ts` | `StreamAccumulator` — buffers OpenAI streaming responses, reconstructs tool calls from delta chunks. |
| `router.ts` | Small-model routing for distill / rewrite / critic. `getFastModelSlug()`, `completeChatJson()` (uses `json_object` format). |
| `query_rewrite.ts` | Multi-query expansion for recall enhancement. `rewriteQueryForRecall()`. |
| `repo_map.ts` | Shallow repository tree builder. `gatherRepoMapLines()`. Reads `.gitignore`, respects size limits per depth. |
| `harness_rules.ts` | 14 named rules injected once per `send()` at round 2 (unless `AGENT_RULE_RECALL=0`): R-PLAN-3STEPS, R-SEQ-SETUP, R-CITE-PATHS, R-DISTILL-HANDOFF, R-ORCH-ID, R-CONTRACT-BOUNDS, R-COMMITMENT-CHECK, R-SEARCH-DIVERSITY, R-ONE-SHOT-RETRY, R-ACTIVE-FIRST, R-LIVE-DATA-HONESTY, R-USER-STANCE-EVIDENCE, R-QUESTION-NOT-BELIEF, R-INFERENCE-LABEL. |
| `token_estimate.ts` | Token counting via `js-tiktoken`. `estimateMessagesTokens()`. |
| `failure_digest.ts` | Collects tool failure patterns. `formatFailureDigestForWorldContext()`. |
| `failure_log.ts` | Append-only failure log under `.agent_failures.jsonl`. `appendFailureLog()`, `failureLogPath()`. |
| `golden_eval.ts` | Golden eval record logging. `appendGoldenEvalRecord()`, `formatGoldenEvalHints()`. |
| `session_event_log.ts` | Session event log attachment. `attachSessionEventLog()`, `maybeAttachSessionEventLog()`. |
| `image_attachments.ts` | Image validation and normalization. Defaults: 5 files, 20 MB total, 4 MB each, JPEG/PNG/WebP/GIF. `validateImageAttachments()`, `buildMessageWithImageAttachments()`. |
| `input_semantics.ts` | Keyboard shortcut + input context resolution. `resolveInputShortcut()`. |
| `vault_path.ts` | Obsidian vault path resolution. `getAgentVaultRoot()`. |
| `workspace_root.ts` | Monorepo root detection via `import.meta.url` or `AGENT_WORKSPACE_ROOT`. `resolveWorkspaceRoot()`. |
| `provider_config.ts` | OpenRouter / OpenAI / Anthropic / xAI API key resolution. `resolveProviderConfig()`, `resolveVisionProviderConfig()`. |
| `runtime_prefs.ts` | Persistent user preferences in `.agent_runtime_prefs.json`. `loadRuntimePreferences()`, `saveRuntimePreferences()`. Non-risky changes auto-applied; risky require confirmation. |
| `json_stable.ts` | Stable JSON key ordering for cache/lock keys. `stableArgsJsonKey()`. |
| `index.ts` | Barrel export for all public APIs. |

**Test files** (in `packages/core/src/`): `epistemic_state.test.ts`, `memory_rank.test.ts`, `memory_retrieval_eval.test.ts`, `runtime_prefs.test.ts`, `safety_judge.test.ts`, `tool_arg_guard.test.ts`.

---

### `packages/tools` — all tool implementations (70 files)

`registerAllTools(registry, emitter, harness?)` in `index.ts` is the single registration point. Passing `harness` enables harness-scoped tool groups.

#### Harness-scoped tools (must NOT be copied parent→child; recreated per harness via `onChildCreated`)

| File | Tools |
|------|-------|
| `orchestration.ts` | `spawn_agent`, `wait_for_agents`, `cancel_agent`, `list_agents`, `verify_result`. Factory: `createOrchestrationTools(harness)`. Sets `harness.onChildCreated` to wire grandchildren. |
| `context_tools.ts` | `check_context`, `compress_context`. Factory: `createContextTools(context)`. Closes over a specific `ContextManager` instance. |

#### Stateless tools

| File | Tools | Notes |
|------|-------|-------|
| `read_file.ts` | `read_file` | Range-aware read; cacheable. |
| `write_file.ts` | `write_file` | Write-back verification; destructive. |
| `list_dir.ts` | `list_dir` | Directory listing; cacheable. |
| `run_shell.ts` | `run_shell` | Shell execution; `dangerLevel: "destructive"`. |
| `process_manager.ts` | `run_background`, `kill_process`, `list_processes`, `read_process_output` | Background process lifecycle. |
| `web_fetch.ts` | `web_fetch` | HTTP GET with retry + readability extraction; cacheable. |
| `web_search.ts` | `web_search` | Keyword search (free tier); cacheable. |
| `web_research.ts` | `web_research` | Orchestrated research: multi-query, dedup, readability. Gate: `AGENT_WEB_RESEARCH=1`. |
| `ask_user.ts` | `ask_user` | Blocks until human response via approval flow. |
| `think.ts` | `think` | Structured reasoning trace; satisfies danger pre-flight gate. |
| `plan.ts` | `plan` | Ordered step list with optional execute indices. Satisfies danger gate when `AGENT_DESTRUCTIVE_GATE=balanced`. |
| `weather_lookup.ts` | `weather_lookup` | Weather by lat/lon or city (free tier). |
| `markets_quote.ts` | `markets_quote` | Best-effort near-real-time quotes for equities, ETFs, FX, commodities, crypto. Returns `as_of`, source, delay, confidence metadata. |

#### Memory tools (backed by `.agent_notes.json`)

| File | Tools |
|------|-------|
| `remember_recall.ts` | `remember`, `recall`, `recall_type`, `forget`, `forget_type`, `memory_stats` |
| `search_memory.ts` | `search_memory` |
| `recall_relevant.ts` | `recall_relevant` — hybrid BM25 + embedding ranked recall. Multi-query expansion via `AGENT_QUERY_REWRITE=1`. Primes world context on root agent. |
| `memory_consolidate.ts` | `memory_consolidate` — consolidate + prune orphan embeddings. `AGENT_MEMORY_GRAPH=1` links notes. |
| `memory_query.ts` | `memory_query` — unified retrieval (exact / type / lexical / hybrid / graph modes). |
| `memory_graph.ts` | `memory_graph` — graph visualization of note linkage. Gate: `AGENT_MEMORY_GRAPH=1`. |

**Memory key convention**: `"{type}:{key}"` (e.g. `reflection:abc123`, `recipe:def456`). The harness auto-writes `reflection:` entries on all-tool-failure rounds and `recipe:` entries on successful turns with ≥4 tool calls.

#### Vault tools (Obsidian brain)

| File | Tools |
|------|-------|
| `vault_tools.ts` | `vault_write`, `vault_read`, `vault_search`, `vault_list`, `vault_links`, `vault_graph`, `vault_delete` |

Wikilink extraction + graph visualization. Per-turn episode chunks: `AGENT_MEMORY_EPISODE=0` to disable.

#### Code intelligence tools

| File | Tools |
|------|-------|
| `ast_grep.ts` | `ast_grep` — AST-based pattern search (multi-language). |
| `symbol_index.ts` | `symbol_index` — extract function/class/type definitions. |
| `find_references.ts` | `find_references` — cross-reference finder (grep-based). |
| `run_tests.ts` | `run_tests` — Jest/Vitest with structured output. |
| `run_lint.ts` | `run_lint` — ESLint with JSON formatting. |
| `execute_code.ts` | `execute_code` — execute arbitrary TypeScript/JavaScript (tsx). |
| `repo_map.ts` | `repo_map` — shallow repo tree (calls core version). |

#### Git tools

| File | Tools |
|------|-------|
| `git_tools.ts` | `git_status`, `git_diff`, `git_log`, `git_branch`, `git_commit` |

#### Diff & patch tools

| File | Tools |
|------|-------|
| `apply_diff.ts` | `apply_diff` — applies unified diff patches. |
| `patch_file.ts` | `patch_file` — line-by-line patching with verification. |

#### Document engine tools (gate: `AGENT_DOC_ENGINE=1`)

Full pipeline for PPTX, DOCX, and PDF generation via an internal IR (DocumentIR) + manifest system.

| File | Tool | Stage |
|------|------|-------|
| `doc_plan.ts` | `doc_plan` | 1. Generate outline (structure + sections) |
| `doc_research_brief.ts` | `doc_research_brief` | 2. Research summary per section |
| `doc_collect_sources.ts` | `doc_collect_sources` | 3. Fetch web + local sources |
| `doc_select_assets.ts` | `doc_select_assets` | 4. Select images/charts from sources |
| `doc_generate_chart_data.ts` | `doc_generate_chart_data` | 5. Generate data tables for charts |
| `doc_compose_chunk.ts` | `doc_compose_chunk` | 6. Compose one section/slide (prose + assets) |
| `doc_lint_layout.ts` | `doc_lint_layout` | 7. Lint layout compliance (margins, typography) |
| `doc_repair_chunk.ts` | `doc_repair_chunk` | 8. Re-compose section if lint fails (budget: `AGENT_DOC_REPAIR_BUDGET`) |
| `doc_render_pptx.ts` | `doc_render_pptx` | 9a. Render IR → PPTX (pptxgenjs) |
| `doc_render_docx.ts` | `doc_render_docx` | 9b. Render IR → DOCX (docx library) |
| `doc_render_pdf.ts` | `doc_render_pdf` | 9c. Render IR → PDF (puppeteer) |
| `doc_export.ts` | `doc_export` | 10. Export to storage (cloud optional) |
| `doc_quality_report.ts` | `doc_quality_report` | 11. QA report (completeness, style diversity, readability) |
| `doc_engine.ts` | — | Shared IR types, source quality classification, path/manifest helpers |
| `doc_style_memory.ts` | — | Persists style preferences across sessions |

#### Vision & browser tools

| File | Tools | Notes |
|------|-------|-------|
| `vision_analyze.ts` | `vision_analyze` | Image analysis via separate vision sidecar model (`AGENT_VISION_MODEL`). |
| `browser_tools.ts` | `browser_open`, `browser_act` | Headless Playwright automation (env-gated). |
| `upload_image.ts` | `upload_image` | Harness-scoped image upload. |

#### Task & meta tools

| File | Tools | Notes |
|------|-------|-------|
| `task_persistence.ts` | `task_checkpoint`, `resume_task` | Save/load task state across sessions. |
| `feature_checklist.ts` | `feature_checklist` | Track feature implementation status (checkbox style). |
| `extract_structured.ts` | `extract_structured` | Harness-scoped JSON extraction. |
| `failure_review.ts` | `failure_review` | Analyze `.agent_failures.jsonl`. Gate: `AGENT_FAILURE_LOG=1`. |
| `set_persona.ts` | `set_persona` | Harness-scoped persona switching. `AGENT_PERSONA_GENERATOR=1` for auto-generation. |
| `meta_tools.ts` | `suggest_improvement`, `view_insights` | Log proposed system prompt improvements to memory. |
| `tool_activation.ts` | (lazy loading) | `activate_tool_family`, `list_tool_families`. Gate: `AGENT_TOOL_LAZY=1`. |

**Tool families** (12+): `files_edit`, `shell`, `git`, `tasks`, `memory_advanced`, `web`, `markets`, `code_intel`, `browser`, `vision`, `meta`, `vault`, `document`, `harness_ui`, `navigation`.

#### System prompt

`systemPrompt.ts` exports `PROTOCOL_CORE` + `buildProtocolDynamicSuffix(toolNames)` — the single authoritative system prompt shared by TUI, web, and eval. Child agents receive a smaller suffix scoped to their tool set.

---

### `packages/tui` — Ink terminal UI (23 files)

`src/index.tsx` creates the harness and calls `registerAllTools`. `useAgent.ts` manages all state via a reducer, subscribing to `AgentEmitter` events.

**Components**: `App.tsx` (multiline input, image attachments, keyboard navigation), `StatusBar`, `MessageItem`, `InputLine`, `InputBox`, `ToolCallCard` (streaming → done/error), `ThinkCard`, `PlanCard`, `SubtaskCard`, `TasksPanel`, `ApprovalModal`, `AskUserModal`, `MemoryStrip` (recent notes, `AGENT_TUI_MEMORY_BULLETS`), `StreamingText`.

**Image attachments**: parse `@image:/path` syntax, validate MIME/size, render inline preview in input.

---

### `packages/web` — Express + React web UI

**Server** (`server/`):

| File | Role |
|------|------|
| `index.ts` | Express setup. PORT default 3001. SSE tuning: keepAliveTimeout 75s, headersTimeout 90s, requestTimeout 0. |
| `agentBridge.ts` | Owns harness instance. Bridges `AgentEmitter` events to SSE. Maintains per-session state across reconnects. |
| `sse.ts` | `SSEManager` — client registry, 500-event history buffer, heartbeat, reconnect via `last-event-id`. |
| `routes.ts` | `GET /api/config`, `POST /api/session/reset`, `GET /api/stream` (SSE), `POST /api/message`, `POST /api/approve`, `POST /api/answer`. Image attachment validation in message handler. |
| `image_attachment_store.ts` | Persists incoming image attachments to disk. |

**Client** (`client/src/`): `App.tsx` (chat UI, image paste/drag-drop, approval/ask_user modals), `useSSE.ts` (SSE hook with reconnect + event buffering), `main.tsx`, `vite.config.ts`.

---

### `packages/eval` — evaluation suite (20 scenario packs)

CLI: `npm run eval -w packages/eval`. Optional JSON sink: `AGENT_EVAL_JSON_SINK=1` → `.agent_eval_runs/`.

| Scenario file | Tests |
|---------------|-------|
| `basic.ts` | Basic capability |
| `reliability.ts` | Tool reliability + error recovery |
| `noise.ts` | Noisy input resilience |
| `memory_retrieval.ts` | Memory recall precision |
| `harness_quality.ts` | Harness reasoning quality |
| `epistemic_eval.ts` | Epistemic state tracking |
| `multi_hop.ts` | Multi-step reasoning |
| `contradiction.ts` | Contradiction detection + resolution |
| `retrieval_precision.ts` | Memory retrieval precision |
| `context_rot.ts` | Context compression robustness |
| `approval_correctness.ts` | Tool approval gate correctness |
| `web_research_quality.ts` | Multi-query web research, dedup |
| `research_grade.ts` | Fact-checked, sourced output |
| `harness_capability.ts` | Orchestration, context, advanced features |
| `long_horizon.ts` | Long-horizon task autonomy |
| `tool_lazy_load.ts` | Lazy tool loading correctness |
| `document_quality.ts` | Document generation quality (PPTX/DOCX/PDF) |
| `document_autonomy.ts` | Document autonomy without explicit prompts |

---

## Key invariants

**Build order matters.** `core` must be built before `tools`. Both must be built before `tui`/`web`/`eval` can typecheck (they import from `dist/`).

**Harness-scoped tools.** `ORCHESTRATION_TOOL_NAMES` in `agent.ts` lists all tools excluded from the parent→child registry copy in `forkChild()`. Any new tool that closes over a `harness` or `ContextManager` reference must be added to this set and wired in `onChildCreated` inside `orchestration.ts`.

**Danger pre-flight.** Tools with `dangerLevel: "destructive"` (`run_shell`, `run_background`) are blocked by `dispatcher.ts` if `think` is not present in the same round's `batchToolNames`. With `AGENT_DESTRUCTIVE_GATE=balanced`, `plan()` also satisfies the gate. Enforced at dispatch time, not in the system prompt.

**Resource locks.** Tools declare `resourceLocks: (args) => string[]`. Lock IDs use prefixes: `file:read:`, `file:write:`, `shell:`. The `ResourceLockManager` always acquires in alphabetical order to prevent deadlock.

**Memory key conventions.** Typed notes use `"{type}:{key}"` storage keys (e.g. `reflection:abc123`, `recipe:def456`). The harness auto-writes `reflection:` entries on all-tool-failure rounds and `recipe:` entries on successful turns with ≥4 tool calls.

**No circular imports.** `core` has zero knowledge of `tools`. The `onChildCreated` hook on `AgentHarness` is how `tools/orchestration.ts` registers child-scoped tools without creating a circular dependency.

**Document engine IR.** All doc_* tools communicate via `DocumentIR` + a manifest file in `.agent_artifacts/`. The render tools (doc_render_*) are the only ones that emit final binary output. Quality gate (`AGENT_DOC_QUALITY_MIN`) is checked inside doc_render_* before export.

**Lazy tool loading.** When `AGENT_TOOL_LAZY=1`, only the baseline profile tools are registered at startup. `activate_tool_family` calls `registerAllTools` for the requested family into the live registry. Never call `registerAllTools` twice for the same family on the same registry instance — the catalog in `tool_catalog.ts` tracks activated families. `max_autonomy` baseline now includes `files_edit` tools to reduce false "missing write tool" loops in coding-heavy sessions.

**Advanced file tools.** The `files_edit` family now includes fast write primitives (`write_file_if_changed`, `search_replace_file`, `move_file`, `copy_file`, `copy_tree`, `mkdir_p`) plus safer orchestration tools (`edit_preview`, `multi_file_apply`, `refactor_plan_apply`, `path_guard`). Prefer `edit_preview` before broad replacements and `multi_file_apply` / `refactor_plan_apply` for multi-file refactors that need rollback-aware execution.

**Safety judge caching.** The safety judge uses an in-process LRU cache keyed on `(toolName, stableArgsJsonKey(args))`. Cache TTL is short (seconds). Do not rely on cached verdicts surviving a harness restart.

**Epistemic + execution state.** Both are per-harness (not shared with child harnesses). `EpistemicState` tracks subgoals; `ExecutionState` tracks contracts and drift. Both are serialized into the `turn_end.workingStatePreview` event and rendered in TUI/web.
