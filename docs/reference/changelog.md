# Changelog

All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) on the `main` branch.

**Current stage:** **alpha** (`v0.0.17` tip of `main`, 2026-06-02). The workspace package may read `0.1.0`, but **beta**, **RC**, and a **v0.1.0 public preview** have not been declared as product releases yet.

Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.

| Surface | Where |
| -------- | ----- |
| **Source of truth** | [`changelog/releases.json`](../../changelog/releases.json) — run `npm run changelog:gen` |
| **Technical changelog (this page)** | Generated from JSON — full `Shipped` bullets |
| **Marketing changelog** | [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog) |
| **Short index** | [CHANGELOG.md](https://github.com/traidy2222/liminal-ai/blob/main/CHANGELOG.md) |

After editing JSON: `npm run changelog:gen`, commit, push, then in [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website): `npm run docs-portal:sync` and `npm run docs-portal:deploy`.

---

## v0.0.17 — 2026-06-02 {#v0-0-17}

**Current alpha.** Team shared memory, Pro cloud sync APIs, NotesFacade in CE, and org-scoped control-plane storage.

**Shipped**

- **Team shared memory** — `team.shared_memory` entitlement drives org-scoped note replication keyed by `org_id` + `workspace_fingerprint`. Workspace and global notes sync across teammates; chat-scoped notes stay local-only (API + ranker enforced). Enterprise Edition pulls before round 0 and pushes after `turn_end` when `AGENT_TEAM_MEMORY_SYNC=1`
- **Control plane** — `GET/PUT /api/team/memory/notes`, status, optional SSE bus (`/api/team/bus/*`), Pro user notes/vault sync (`/api/pro/cloud_sync/*`), session history upload, org tables + Team checkout creates org owner, invite flow with seat limits
- **CE contracts** — `NotesFacade`, `StoredNote` org fields (`userId`, `orgId`, `revision`), `runWithOrgContext`, harness hooks `onTurnStartMemorySync` / `onTurnEndMemorySync` / `onRecallMerge`, `AGENT_TEAM_EMBED_ON_RECALL` to avoid full-store embedding on recall
- **Web Settings** — Team memory status + org id on `/api/vireon/account` and in the Settings modal
- **Dev** — `AGENT_CONTROL_PLANE_URL` for local EE sync against `:3002`; changelog now generated from `changelog/releases.json` (`npm run changelog:gen`)
- **Docs** — [Team memory](../guides/team-memory.md), [Pro & Enterprise](../reference/pro-and-enterprise.md), [Enterprise Edition](../reference/enterprise-edition.md)

---

## v0.0.16 — 2026-06-02 {#v0-0-16}

Managed inference for Pro, Vireon sign-in, dynamic OpenRouter routing, EE auto-install, security hardening.

**Shipped**

- **Managed inference (Pro)** — Chat, embeddings, vision, and audio sidecars can route through Vireon's metered OpenAI-compatible proxy (`AGENT_INFERENCE_MODE`: `auto` | `managed` | `byok`; default `auto`). Pro sign-in prefers managed routing with included monthly credits and a clear top-up path when budget is exhausted. Community Edition stays bring-your-own-key with no account
- **Vireon sign-in** — `liminal login` (loopback browser flow) or **Settings → Sign in** stores the license under `~/.liminal/`; no `.env` API-key paste for Pro managed mode
- **Dynamic OpenRouter routing** — Price-sorted provider selection (`AGENT_PROVIDER_STRATEGY`), sticky `session_id` for KV-cache affinity (`AGENT_OPENROUTER_SESSIONS`), and session-epoch rotation on upstream 429s (`adaptive` strategy) so rate limits do not stall long runs
- **Enterprise Edition auto-install** — Pro+ login downloads the proprietary EE bundle to `~/.liminal/enterprise/` (checksum-verified); implementations stay out of the public CE repo while gating cloud/team entitlements
- **Security hardening** — Control-plane rate limiting and auth hygiene, web API token gate bound to loopback, tighter guards on `run_shell` and `execute_code`
- **Inference UX** — Web inference usage/credits banner; steadier sign-in polling for managed sessions
- **Dictation & ASR defaults** — Default `AGENT_TRANSCRIBE_MODEL` is `nvidia/parakeet-tdt-0.6b-v3` (English + EU); `AGENT_DICTATION_WEB_SPEECH=0` keeps browser Web Speech off so dictation transcribes **server-side** only (no Chrome→Google path). Web `/api/config` exposes the toggle
- **Docs** — [Managed inference](../guides/managed-inference.md), [Accounts & licensing](../guides/accounts-and-licensing.md), [Pro & Enterprise](../reference/pro-and-enterprise.md), [Voice I/O](../guides/voice.md)

---

## v0.0.15 — 2026-05-31 {#v0-0-15}

Open-core licensing, Vireon control plane, Enterprise Edition package, dynamic workflows.

**Shipped**

- **Open-core entitlements** — Offline-verifiable license tokens (Ed25519; harness holds public key only). Verified licenses cache to `~/.liminal/license.json` with bounded offline grace. Community Edition needs **no license** — full harness on your machine
- **License tiers** — `community` · `pro` · `team` · `enterprise` (each inherits below). Tiers gate cloud/sync/governance features by entitlement key, not core agent capability
- **Vireon control plane** — `@liminal/control-plane`: Stripe subscriptions + webhooks, Supabase entitlements, signed license issuance (deploy beside [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website))
- **Enterprise Edition package** — Proprietary Pro/Team/Enterprise implementations in a separate package; CE repo stays fully functional without EE installed
- **Dynamic workflows** — `plan_workflow` → `run_workflow` execute a declarative multi-phase spec: bounded concurrency waves per phase, per-agent results in an out-of-context store (`.agent_workflows/`), distilled phase summaries back to parent context only. Root-only, approval-gated (`AGENT_WORKFLOWS`). Intent classifier can auto-activate the `workflow` tool family under lazy loading
- **Docs** — [Dynamic workflows](../guides/dynamic-workflows.md), [Pro & Enterprise](../reference/pro-and-enterprise.md), [Enterprise Edition](../reference/enterprise-edition.md)

---

## v0.0.14 — 2026-05-30 {#v0-0-14}

LLM memory curator, output-effort dial, voice I/O, retrieval reranker, deeper prompt caching.

**Shipped**

- **Memory curator** — `curate_memory` (dry-run by default) sends a metadata-annotated slice of the note store to the model, which returns prune / merge / re-confidence ops; a deterministic safety-rail veto then protects `user:`/`identity:`/`pref:` keys, high-access, and too-young notes. Deletion is **reversible**: `forget` and the curator soft-delete the full note to `notes.archive.json` (`AGENT_MEMORY_ARCHIVE`) before removing; `restore_memory` recovers it. Tunables: `AGENT_CURATOR_TIMEOUT_MS`, `AGENT_CURATOR_MAX_TOKENS`, `AGENT_CURATOR_PROTECT_GLOBAL` (off — `global` is the default scope, not a durability signal)
- **Output effort** — `AGENT_EFFORT` (`low` | `medium` | `high` | `xhigh`) — a deliverable-thoroughness dial injected as a system-prompt directive (rule **R-EFFORT**), exposed as a Settings dropdown. A separate axis from reasoning: it scales completion budget and output completeness/coverage, not internal `think()`/`reason()` depth
- **Voice I/O** — Text-to-speech (`speak`, Kokoro / OpenAI voices, per-turn budget + near-duplicate suppression) and live microphone **dictation** in the web UI; voice-mode tool gating. See [Voice I/O](../guides/voice.md)
- **Retrieval** — Second-stage recall reranker over first-stage BM25 + embedding hits; fast-model JSON response cache to cut repeat sidecar calls
- **Prompt cache** — Rolling `cache_control` breakpoint over conversation history (`AGENT_PROMPT_CACHE_ROLLING`) plus volatile-tail context ordering (`AGENT_CTX_VOLATILE_TAIL`), so the cache extends across accumulated tool-result history, not just the static prefix
- **File tools** — `find_files` (path/name glob) and `delete_file` (approval-gated); a catalog reachability test guards against tools unreachable under lazy loading
- **Chat UX** — Markdown renderer for assistant output, session screenshot export, persona shell refactor (Hud / Minimal / Studio / Terminal / Composer)
- **Web** — Greeting fires on reload without blocking, SSE reconnect robustness; OpenRouter `session_id` on chat completions for request grouping
- **Reliability** — More reliable long `write_file` paths and HTML chunk guards

---

## v0.0.13 — 2026-05-28 {#v0-0-13}

**Shipped**

- **Provider model presets** — One-click OpenRouter packs in web Settings (main + fast slots, provider order pins); DeepSeek, Claude 4.7, GPT 5.5, Gemini 3.5, Qwen 3.6, MiMo, Llama 4, Kimi, GLM, and cross-vendor mixes; slugs verified against OpenRouter `GET /models`
- **Settings completeness** — Full harness env catalog in the web Settings modal with field metadata (aligned with `HARNESS_ENV_DEFAULTS`)
- **Turn end** — Simpler end-of-turn pipeline on `send()` (less redundant work)
- **Repo** — Removed experimental Android app scaffold and `mobile-contract` package

---

## v0.0.12 — 2026-05-26 {#v0-0-12}

Research ledger, identity memory, FSL relicense, web chat chrome polish.

**Shipped**

- **Research ledger** — Per-`send()` tracking of `web_search` / `web_fetch` (queries, surfaced URLs, fetch outcomes, deduped URLs); compact context injection each round; harness tool `research_state` (summary / pending / fetched / failures views)
- **Identity memory** — Intent `identityQuery` / `identityProvision`; LLM-generated recall queries; on-disk scan of `user:` / `identity:` / `pref:` notes; auto-`remember` with `scope: global` for `user:name`; protocol reminder not to use OS username as display name
- **Recall fix** — `recall_relevant` accepts `query` or `queries`
- **Web UI** — Chat switcher embedded in each persona shell header row; portaled dropdown + click-outside dismiss
- **PASTE** (optional) — Predictive tool-call speculation (`AGENT_PASTE_*`, off by default)
- **License** — **FSL-1.1-MIT** (MIT Future) across the harness; compliance documentation expanded; fair-source framing on marketing/install
- **Reliability** — `write_file` integrity check fix for apostrophes inside comments

---

## v0.0.11 — 2026-05-24 {#v0-0-11}

User-global storage, web multi-chat, audio transcription, and connector tools.

**Shipped**

- **Storage layout** — `~/.liminal/` user-global memory, persona, prefs, vault; per-chat folders for sessions/artifacts; `AGENT_STORAGE_LAYOUT=legacy`
- **Web multi-chat** — `ChatManager`, chat list/switch APIs, idle bridge eviction, SSE scoped to the active chat
- **Audio** — `transcribe_audio`, upload attachments, OpenRouter Whisper defaults, dictation env knobs, web mic UI
- **API connectors** — `api_connect` / `api_disconnect` / `api_list` (OpenAPI → dynamic tools, persisted connections)
- **MCP** — `mcp_attach` to wire MCP servers into the live registry
- **Memory** — `memory_promote`, `memory_neighbors`, `consolidate_chat`; federated rank scoring; exploratory-turn debias (`AGENT_MEMORY_DEBIAS`, optional `AGENT_MEMORY_EXPLORATORY_AUTO_RECALL`)
- **Harness** — `AGENT_PROMPT_CACHE` (provider cache breakpoints); intent inference heuristics + research finalize judge; vault index helper
- **Docs** — [Roadmap](./roadmap.md)

---

## v0.0.10 — 2026-05-23 {#v0-0-10}

Task Worlds landed earlier on May 23 then was removed the same day in favor of execution state and compensation wiring.

**Shipped**

- `liminal` CLI (dev) — `setup`, `doctor`, `web`, `tui`, `update`, `path`
- Install scripts: `scripts/install.sh`, `scripts/install.ps1`
- Recipe library v2 — compounds on strategy shape, not generic `recipe:` notes
- Harness power pass — execution state, compensation playback, `breakdown`, tool DAG `depends_on`, contract→tool mapping
- Workflow evals + additional core baseline tests
- Web fetch — Wikipedia extracts, pagination, distill bypass, model `max_chars` floor
- Persona UI themes — distinct palettes, HudShell theme wiring
- Per-harness workspace root, streaming edit previews in web

---

## v0.0.9 — 2026-05-22 {#v0-0-9}

Streaming writes, reasoning budget, Playwright browser + CAPTCHA, document engine, license file (later FSL), compensation ledger.

**Shipped**

- **Streaming large-file writes** — `.agent_write_staging/`, manifest resume after truncation; write integrity nudges; legacy patch tools removed
- **Compensation ledger** for partial plan rollback; session tool-output index; outcome scoring; optional self-heal lint
- **Intent classification** and **reasoning budget** (effort + think-depth per turn); external `think()` + `reason()` surface; two-tier main/fast models; effort learning
- **Playwright browser** family + stealth; **CAPTCHA** solving (2captcha / CapSolver)
- **Document engine** — compose → lint → repair → PPTX / DOCX / PDF export with quality gate
- `self_telemetry`, `rename_symbol`, `git_worktree`; recipe library redesign; Settings catalog + provider presets in web UI
- MIT `LICENSE` file at this milestone (superseded by FSL-1.1-MIT in v0.0.12)

---

## v0.0.8 — 2026-05-15 {#v0-0-8}

Harness defaults + web Settings, Obsidian vault discovery, persona bootstrap/themes, orchestration expansion.

**Shipped**

- **`HARNESS_ENV_DEFAULTS`** typed module (~190 keys); web **Settings** modal with field metadata and provider presets
- **Obsidian vault auto-discovery** from `obsidian.json`; web_fetch wall-clock budget + readability worker
- Removed **`web_research`** tool → `web_search` + parallel `web_fetch`
- Persona generator, bootstrap modal (TUI + web), **PersonaUiTheme** + web shell router, personality heartbeat (off by default)
- Expanded harness lifecycle hooks; orchestration catalog growth; VitePress docs restructure

---

## v0.0.7 — 2026-05-12 {#v0-0-7}

World context, session JSONL, platform context, agenda/scheduler, auto-dream telemetry.

**Shipped**

- **World context** gatherers + **harness rule recall** at round 2; **runtime prefs** (`.agent_runtime_prefs.json`); **platform context** (OS, shell, git, ports, terminal snapshots)
- **Agenda / scheduler / synthesis / independence** tool family; web_fetch readability improvements
- **Session JSONL** — rollup / delta / trace modes under `.agent_sessions/`; provider pacing gate; auto-dream scanner telemetry in web UI
- TUI/web session metrics; **runtime settings** tools; experimental Android chat scaffold (later removed)

---

## v0.0.6 — 2026-05-10 {#v0-0-6}

Unified file edits, research credibility tiers, dynamic tools, MCP client.

**Shipped**

- **`write_file` + `edit_file`** canonical surface; **`grep_file`** always-on
- **Source credibility tiers** and contradiction surfacing in research rules
- **Dynamic tools** persisted to disk; **MCP client**; progress events for long-running tools
- SSE reconnect hardening; provider retry lines visible in UI

---

## v0.0.5 — 2026-05-09 {#v0-0-5}

Upgrade V — shared memory bus, tool DAG, semantic compression, goal/branch tools.

**Shipped**

- **Shared memory bus**; spaced-repetition decay in `memory_rank`
- **TaskOrchestrator DAG** with `depends_on`; **semantic compression** for context
- `decompose_goal`, `branch_explore`, `verify_contract`; plugin loader; adaptive protocol suffix

---

## v0.0.4 — 2026-05-08 {#v0-0-4}

Vision sidecar, markets quotes, self-heal lint, document engine scaffold.

**Shipped**

- **Vision sidecar** (`vision_analyze`); **markets_quote** multi-source
- **Self-heal lint** loop (off by default); **document engine** scaffolding (`doc_*` family begins)
- Streaming resilience; long-horizon autonomy hooks; expanded file operations

---

## v0.0.3 — 2026-05-05 {#v0-0-3}

Lazy tool families, hybrid recall, safety judge, workspace-root grounding.

**Shipped**

- **Tool argument guard**; vault path resolution; **workspace-root grounding**
- **Safety judge** optional pre-flight; **hybrid recall** (BM25 + embeddings)
- **Lazy tool loading** — `list_tool_families` / `activate_tool_family`
- README + architecture diagram fixes

---

## v0.0.2 — 2026-05-03 {#v0-0-2}

Dynamic persona generation, child harness wiring.

**Shipped**

- LLM-generated personas with strength dial and modifiers
- **`onChildCreated`** child harness tool registration; resource lock caps on persona tooling

---

## v0.0.1 — 2026-05-03 {#v0-0-1}

Monorepo scaffold, AgentHarness, tools, TUI, web, eval, Liminal rebrand.

**Shipped**

- Workspaces: `packages/core`, `tools`, `tui`, `web`, `eval`
- **AgentHarness** ReAct loop, approvals, context manager
- Initial tools: files, shell, git, memory, web, `think` / `plan` / `reason`
- Ink TUI + Express/React web with SSE; first eval scenarios

---

## Planned (not started)

See the full [Roadmap](./roadmap.md) for what each milestone means.

| Stage | Target | Status |
|-------|--------|--------|
| Beta | Stability + defaults freeze candidate | Not started |
| RC | Ship checklist, docs freeze | Not started |
| v0.1.0 | Public preview tag + install GA | Not started |

---

**Commits on `main`:** [github.com/traidy2222/liminal-ai/commits/main](https://github.com/traidy2222/liminal-ai/commits/main)
