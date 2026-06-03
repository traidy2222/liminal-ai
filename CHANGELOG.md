# Changelog

All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) are documented here and on the docs portal: [docs.vireondynamics.com/liminal/reference/changelog](https://docs.vireondynamics.com/liminal/reference/changelog).

**Current stage:** **alpha** (`v0.0.16` tip of `main`, 2026-06-02). **Beta**, **RC**, and **v0.1.0 public preview** have not been declared as product releases yet.

Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.

Marketing (richer notes): [vireondynamics.com/liminal/changelog](https://vireondynamics.com/liminal/changelog)

## [v0.0.16] — 2026-06-02 — Current alpha

Optional Pro managed inference through Vireon's metered proxy (`AGENT_INFERENCE_MODE`), browser/CLI sign-in (`liminal login`), price-sorted OpenRouter routing with sticky sessions and 429-aware rotation, Enterprise Edition auto-install on login, inference credits banner in web UI, Parakeet ASR default with server-side dictation (`AGENT_DICTATION_WEB_SPEECH=0`), and a security-hardening pass.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-16)

## [v0.0.15] — 2026-05-31

Open-core foundation: offline Ed25519 license tiers (`community`→`enterprise`), the CE/EE split, `@liminal/control-plane` (Stripe + Supabase), and dynamic multi-agent workflows (`plan_workflow`/`run_workflow`, `AGENT_WORKFLOWS`).

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-15)

## [v0.0.14] — 2026-05-30

LLM memory curator with reversible soft-delete, output-effort dial, voice I/O (TTS + dictation), second-stage recall reranker, rolling prompt-cache breakpoint, `find_files`/`delete_file`, chat markdown renderer.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-14)

## [v0.0.13] — 2026-05-28

OpenRouter provider presets in Settings, full harness env catalog in UI, simpler turn end, Android scaffold removed.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-13)

## [v0.0.12] — 2026-05-26

Research ledger + `research_state`, identity memory, FSL-1.1-MIT relicense, inline web chat switcher, `recall_relevant` fix, optional PASTE, write_file integrity fix.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-12)

## [v0.0.11] — 2026-05-24

User-global `~/.liminal/` storage, web multi-chat, audio transcription, OpenAPI/MCP connectors, memory federation, prompt cache.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-11)

## [v0.0.10] — 2026-05-23

Task Worlds removed; execution state + compensation pass, `liminal` dev CLI, recipe library v2, web_fetch and persona theme polish.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-10)

## [v0.0.9] — 2026-05-22

Streaming writes, reasoning budget, Playwright browser + CAPTCHA, document engine, MIT license file (later FSL), compensation ledger.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-9)

## [v0.0.8] — 2026-05-15

Harness defaults + web Settings, Obsidian vault discovery, persona bootstrap/themes, orchestration expansion.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-8)

## [v0.0.7] — 2026-05-12

World context, session JSONL, platform context, agenda/scheduler, auto-dream telemetry.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-7)

## [v0.0.6] — 2026-05-10

Unified file edits, research credibility tiers, dynamic tools, MCP client.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-6)

## [v0.0.5] — 2026-05-09

Upgrade V — shared memory bus, tool DAG, semantic compression, goal/branch tools.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-5)

## [v0.0.4] — 2026-05-08

Vision sidecar, markets quotes, self-heal lint, document engine scaffold.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-4)

## [v0.0.3] — 2026-05-05

Lazy tool families, hybrid recall, safety judge, workspace-root grounding.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-3)

## [v0.0.2] — 2026-05-03

Dynamic persona generation, child harness wiring.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-2)

## [v0.0.1] — 2026-05-03

Monorepo scaffold, AgentHarness, tools, TUI, web, eval, Liminal rebrand.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-1)

## Planned (not started)

| Stage | Target | Status |
|-------|--------|--------|
| Beta | Stability + defaults freeze candidate | Not started |
| RC | Ship checklist, docs freeze | Not started |
| v0.1.0 | Public preview tag + install GA | Not started |

---

[v0.0.13]: https://github.com/traidy2222/liminal-ai/commits/main
