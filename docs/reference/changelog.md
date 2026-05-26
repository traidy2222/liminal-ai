# Changelog

All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) on the `main` branch.

**Current stage:** **alpha** (`v0.0.12` tip of `main`, 2026-05-26). The workspace package may read `0.1.0`, but **beta**, **RC**, and a **v0.1.0 public preview** have not been declared as product releases yet.

Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.

---

## v0.0.12 — 2026-05-26 {#v0-0-12}

**Current alpha.** Research ledger, LLM identity memory, and web chat chrome polish.

**Shipped**

- **Research ledger** — Per-`send()` tracking of `web_search` / `web_fetch` (queries, surfaced URLs, fetch outcomes, deduped URLs); compact context injection each round; new harness tool `research_state` (summary / pending / fetched / failures views)
- **Identity memory** — Intent `identityQuery` / `identityProvision`; LLM-generated recall queries (not keyword lists); on-disk scan of `user:` / `identity:` / `pref:` notes injected before answer; auto-`remember` with `scope: global` when the user states their name (`user:name`); protocol reminder not to use OS username as display name
- **Recall fix** — `recall_relevant` accepts `query` or `queries` (schema no longer requires `query` when only `scope` was passed)
- **Web UI** — Chat switcher embedded in each persona shell header row (HUD, Studio, Terminal status line, Minimal) instead of a separate top strip; portaled dropdown + click-outside dismiss
- **PASTE** (optional) — Predictive tool-call speculation from paste patterns (`AGENT_PASTE_*`, off by default)

---

## v0.0.11 — 2026-05-24 {#v0-0-11}

User-global storage, web multi-chat, audio transcription, and connector tools.

**Shipped**

- **Storage layout** — `~/.liminal/` user-global memory, persona, prefs, vault; per-chat folders for sessions/artifacts; `AGENT_STORAGE_LAYOUT=legacy` to keep old paths
- **Web multi-chat** — `ChatManager`, chat list/switch APIs, idle bridge eviction, SSE scoped to the active chat
- **Audio** — `transcribe_audio`, upload attachments, OpenRouter Whisper defaults, dictation env knobs, web mic UI + auto-transcribe on upload
- **API connectors** — `api_connect` / `api_disconnect` / `api_list` (OpenAPI → dynamic tools, persisted connections)
- **MCP** — `mcp_attach` to wire MCP servers into the live registry
- **Memory** — `memory_promote`, `memory_neighbors`, `consolidate_chat`; federated rank scoring; exploratory-turn debias (`AGENT_MEMORY_DEBIAS`, optional `AGENT_MEMORY_EXPLORATORY_AUTO_RECALL`)
- **Harness** — `AGENT_PROMPT_CACHE` (provider cache breakpoints); intent inference heuristics + research finalize judge; vault index helper
- **Docs** — [Roadmap](./roadmap.md) studio product pipeline (Teams, Bench, SDK) with marketing links
- **Install** — script comments point at hosted `vireondynamics.com/install/` URLs

---

## v0.0.10 — 2026-05-23 {#v0-0-10}

Task Worlds landed earlier on May 23 then was **removed** the same day in favor of **execution state** and **compensation** wiring.

**Shipped**

- `liminal` CLI (dev) — `setup`, `doctor`, `web`, `tui`, `update`, `path`
- Install scripts: `scripts/install.sh`, `scripts/install.ps1`
- Recipe library v2 — compounds on strategy shape, not generic `recipe:` notes
- Harness power pass — execution state, compensation playback, `breakdown`, tool DAG `depends_on`, contract→tool mapping
- Workflow evals + additional core baseline tests
- Web fetch — Wikipedia extracts, pagination, distill bypass, model `max_chars` floor
- Persona UI themes — distinct palettes, HudShell theme wiring
- Per-harness workspace root, streaming edit previews in web

**Removed:** Task Worlds (`task_world_*` tools, web HUD mission panel) in commit `199d043`. Mission-style state today is **execution state** + **epistemic state**, not Task Worlds.

---

## v0.0.9 — 2026-05-22 {#v0-0-9}

Streaming writes, reasoning budget, Playwright browser + CAPTCHA, document engine, LICENSE (FSL-1.1-MIT), compensation ledger.

---

## v0.0.8 — 2026-05-15 {#v0-0-8}

Harness defaults + web Settings, Obsidian vault discovery, persona bootstrap/themes, orchestration expansion.

---

## v0.0.7 — 2026-05-12 {#v0-0-7}

World context, session JSONL, platform context, agenda/scheduler, auto-dream telemetry.

---

## v0.0.6 — 2026-05-10 {#v0-0-6}

Unified file edits, research credibility tiers, dynamic tools, MCP client.

---

## v0.0.5 — 2026-05-09 {#v0-0-5}

Upgrade V — shared memory bus, tool DAG, semantic compression, goal/branch tools.

---

## v0.0.4 — 2026-05-08 {#v0-0-4}

Vision sidecar, markets quotes, self-heal lint, document engine scaffold.

---

## v0.0.3 — 2026-05-05 {#v0-0-3}

Lazy tool families, hybrid recall, safety judge, workspace-root grounding.

---

## v0.0.2 — 2026-05-03 {#v0-0-2}

Dynamic persona generation, child harness wiring.

---

## v0.0.1 — 2026-05-03 {#v0-0-1}

Monorepo scaffold, AgentHarness, tools, TUI, web, eval, Liminal rebrand.

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
