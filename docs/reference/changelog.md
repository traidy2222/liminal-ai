# Changelog

All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) on the `main` branch.

**Current stage:** **alpha** (`v0.0.10` tip of `main`, 2026-05-23). The workspace package may read `0.1.0`, but **beta**, **RC**, and a **v0.1.0 public preview** have not been declared as product releases yet.

Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.

---

## v0.0.10 — 2026-05-23 {#v0-0-10}

**Current alpha.** Task Worlds landed earlier on May 23 then was **removed** the same day in favor of **execution state** and **compensation** wiring.

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

Streaming writes, reasoning budget, Playwright browser + CAPTCHA, document engine, MIT license file, compensation ledger.

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
