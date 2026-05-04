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

# Typecheck (no build output — fast CI check)
npm run typecheck                      # all workspaces
npx tsc --noEmit -p packages/core/tsconfig.json
npx tsc --noEmit -p packages/tools/tsconfig.json
npx tsc --noEmit -p packages/tui/tsconfig.json
npx tsc --noEmit -p packages/web/tsconfig.json

# After modifying core/src/*.ts, always rebuild before typechecking dependents:
npm run build -w packages/core && npx tsc --noEmit -p packages/tools/tsconfig.json
```

Verification: `npm run typecheck`, `npm run test --workspace=@liminal/core` (tool arg guard + safety judge), and manual TUI/web runs.

`.env` at the monorepo root requires `OPENROUTER_API_KEY`. Optional: `AGENT_WORKSPACE_ROOT` sets the monorepo root for world context, `.agent_notes.json`, artifacts, and tool path defaults; the TUI, web server, and eval CLI set it from `import.meta.url` and `chdir` there unless you override. Optional: `AGENT_SEND_TIMEOUT_MS` (default 600000) caps wall-clock time for one full `send()` / ReAct run in TUI and web. For Obsidian, set `AGENT_VAULT_PATH` to your vault folder (absolute path); otherwise vault tools use `~/.agent_vault`. Optional: `AGENT_SAFETY_JUDGE=1` enables a heuristic + single-token LLM check before user approval on `requiresApproval` tools; `AGENT_SAFETY_JUDGE_MODEL` overrides the classifier model (defaults to the harness model).

Memory / retrieval: `AGENT_EMBED_MODEL` enables OpenRouter `/embeddings` + on-disk `.agent_memory.index.json` (updated on note writes) for `recall_relevant` and hybrid **Relevant memory** priming in world context. `AGENT_MEMORY_AUTO_EXTRACT=1` runs one small completion at turn end and `directCall`s `remember` for durable extractions. `AGENT_MEMORY_EPISODE=0` disables per-turn `vault_write` episode chunks when a vault path is set. `AGENT_MEMORY_AUTOLINK=1` suggests wikilinks after `remember` / `vault_write`. `memory_consolidate` can take `prune_orphan_embeddings` to trim stale embedding rows.

Harness quality: inception uses **PROTOCOL_CORE** + `buildProtocolDynamicSuffix(toolNames)` (smaller for scoped child agents). World context includes a **Repo map**; tool **repo_map** returns the same shallow tree on demand. `AGENT_RECALL_EVERY_N` mid-turn `recall_relevant` priming; proactive `forceCompress` at ~65% usage once per send; **working state** defaults on (web/TUI) with budget hints + `turn_end.workingStatePreview`. `AGENT_CRITIC=1` runs `verify_result` when the final answer looks code/path-heavy; `AGENT_CRITIC_EVIDENCE=1` attaches tool-output excerpts to the critic. `AGENT_SPECULATIVE_READS=1` augments `read_file` with a few resolved relative imports. `AGENT_FAST_MODEL` routes JSON-style calls (query rewrite, distill, auto-extract). `AGENT_QUERY_REWRITE=1` + multi-query `recall_relevant`; `AGENT_DISTILL=1` shrinks huge tool outputs to `.agent_artifacts/`; `AGENT_MEMORY_GRAPH=1` links notes + `memory_graph`; `AGENT_WEB_READABILITY=1` + `AGENT_WEB_RESEARCH=1` for article extraction / orchestrated web research; `AGENT_FAILURE_LOG=1` + `failure_review`; `AGENT_EVAL_JSON_SINK=1` logs eval runs under `.agent_eval_runs/`.

## Architecture

### Package dependency graph

```
packages/core       — compiled (dist/), no runtime deps except openai SDK
     ↑
packages/tools      — compiled (dist/), depends on core
     ↑              ↑
packages/tui    packages/web    — run directly via tsx, never compiled
```

`core` and `tools` emit `dist/` via `tsc`. `tui` and `web` use `node --import tsx/esm` at runtime so they never need a build step themselves.

### `packages/core` — the harness engine


| File              | Role                                                                                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.ts`        | `AgentHarness` — the main class. Owns the ReAct loop (`runReActLoop`), retry logic, error recovery injection, per-turn state (tool error counts, context alerts, recipe recording). `forkChild()` spawns scoped child harnesses for parallel sub-agents.   |
| `dispatcher.ts`   | `ToolDispatcher` — executes a single tool call: schema validation → danger pre-flight → resource lock → approval gate → handler → unlock. Has `directCall()` for internal housekeeping (bypasses approval/locking).                                        |
| `context.ts`      | `ContextManager` — conversation history + ACON-lite compression. When token usage exceeds `thresholdFraction`, collapses old rounds into a structured summary block instead of blanking them individually. `forceCompress(summary)` is the manual trigger. |
| `orchestrator.ts` | `ResourceLockManager` (alphabetical lock ordering, TTL eviction, 50ms polling) + `TaskOrchestrator` (task registry with complete/fail/cancel). Shared across all agents in a tree.                                                                         |
| `registry.ts`     | `ToolRegistry` — simple Map with `register/get/getAll/has/toOpenAIFormat`.                                                                                                                                                                                 |
| `events.ts`       | `AgentEmitter` — typed wrapper around Node `EventEmitter`. Events: `text`, `tool_start`, `tool_delta`, `tool_approval`, `tool_result`, `ask_user`, `turn_end`, `error`, `subtask_spawned`, `subtask_complete`.                                             |
| `types.ts`        | All shared interfaces. `ToolDefinition` includes `resourceLocks?` and `dangerLevel?` fields. `AgentConfig` carries orchestration depth/concurrency limits.                                                                                                 |


### `packages/tools` — all tool implementations

`registerAllTools(registry, emitter, harness?)` in `index.ts` is the single registration point called by both entry points. Passing `harness` enables the five harness-scoped tool groups (orchestration + context).

**Harness-scoped tools** (must NOT be copied parent→child; recreated per harness via `onChildCreated`):

- `orchestration.ts` — `spawn_agent`, `wait_for_agents`, `cancel_agent`, `list_agents`, `verify_result`. Factory: `createOrchestrationTools(harness)`. Sets `harness.onChildCreated` to wire grandchildren.
- `context_tools.ts` — `check_context`, `compress_context`. Factory: `createContextTools(context)`. Closes over a specific `ContextManager` instance.

**Stateless tools**: `read_file`, `write_file` (with write-back verification), `list_dir`, `run_shell`, `run_background`, `kill_process`, `list_processes`, `read_process_output`, `web_fetch`, `web_search`, `think`, `plan`, `ask_user`.

**Persistent memory tools** (backed by `.agent_notes.json`): `remember` (supports `type` param: `fact|experience|entity|belief|reflection|recipe`), `recall`, `recall_type`, `search_memory`.

**Meta-harness tools**: `suggest_improvement`, `view_insights` — agent logs proposed system prompt improvements to memory.

`systemPrompt.ts` exports `INCEPTION_MESSAGES` — the single authoritative system prompt shared by both TUI and web.

### `packages/tui` — Ink terminal UI

`src/index.tsx` creates the harness and calls `registerAllTools`. `useAgent.ts` manages all state via a reducer, subscribing to `AgentEmitter` events. `App.tsx` renders message entries: assistant text, tool cards (streaming → done/error), think bubbles, plan cards, subtask depth cards.

### `packages/web` — Express + React web UI

`server/agentBridge.ts` owns the harness and bridges `AgentEmitter` events to SSE. `server/sse.ts` manages the SSE connection. `server/routes.ts` exposes `/api/stream` (SSE), `/api/message` (POST), `/api/approve` (POST), `/api/answer` (POST). The React client in `client/` mirrors the TUI reducer pattern via `useSSE.ts`.

## Key invariants

**Build order matters.** `core` must be built before `tools`. Both must be built before `tui`/`web` can typecheck (they import from `dist/`).

**Harness-scoped tools.** `ORCHESTRATION_TOOL_NAMES` in `agent.ts` lists all tools that must be excluded from the parent→child registry copy in `forkChild()`. Any new tool that closes over a `harness` or `ContextManager` reference must be added to this set and wired in `onChildCreated` inside `orchestration.ts`.

**Danger pre-flight.** Tools with `dangerLevel: "destructive"` (`run_shell`, `run_background`) are blocked by `dispatcher.ts` if `think` is not present in the same round's `batchToolNames`. This is enforced at dispatch time, not in the system prompt.

**Resource locks.** Tools declare `resourceLocks: (args) => string[]`. Lock IDs use prefixes: `file:read:`, `file:write:`, `shell:`. The `ResourceLockManager` always acquires in alphabetical order to prevent deadlock.

**Memory key conventions.** Typed notes use `"{type}:{key}"` storage keys (e.g. `reflection:abc123`, `recipe:def456`). The harness auto-writes `reflection:` entries on all-tool-failure rounds and `recipe:` entries on successful turns with ≥4 tool calls.

**No circular imports.** `core` has zero knowledge of `tools`. The `onChildCreated` hook on `AgentHarness` is how `tools/orchestration.ts` registers child-scoped tools without creating a circular dependency.