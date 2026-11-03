# Changelog

All notable changes to [Liminal AI](https://github.com/traidy2222/liminal-ai) are documented here and on the docs portal: [docs.vireondynamics.com/liminal/reference/changelog](https://docs.vireondynamics.com/liminal/reference/changelog).

**Current stage:** **beta** (`v0.1.13` tip of `main`, 2026-11-03). Desktop downloads are published through the public preview release channel.

**Single source:** edit [`changelog/releases.json`](changelog/releases.json), then run `npm run changelog:gen`.

Format: **v0.0.x** entries keyed to the last GitHub push in each slice. Dates are real push dates.

Marketing (richer notes): [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog)

## [v0.1.13] — 2026-11-03 — Current beta

Fix repeated Gmail label errors caused by client-side field rewriting, reduce redundant MCP schemas, and align Gmail draft, ID and read-only handling with the discovered tools.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-13)

## [v0.1.12] — 2026-11-03

Existing Google access refreshes independently of an optional Liminal license. Reconnect checks require usable credentials, and the local Docs, Sheets and Slides service starts with hosted OAuth without requiring a client secret on your computer.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-12)

## [v0.1.11] — 2026-11-03

Desktop users can choose to share basic adoption and repeat-use milestones with Vireon. Sharing is off by default and is separate from website analytics and model connections.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-11)

## [v0.1.10] — 2026-11-03

Desktop-owned sidecars tolerate closed stdout and stderr pipes so parent-exit cleanup can finish. Prevents recursive EPIPE logging from keeping the old runtime alive and blocking the next update.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-10)

## [v0.1.9] — 2026-11-03

Desktop-owned sidecars detect when their launching app exits and shut down, releasing the install folder for updates. Standalone and explicitly attached servers retain their existing lifecycle.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-9)

## [v0.1.8] — 2026-11-02

Windows updates launch the Node helper directly and require a startup acknowledgement before closing the app. Includes the completed harness audit repairs for interrupted tools, concurrent writes, guest isolation and public-web requests.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-8)

## [v0.1.7] — 2026-11-02

DeepSeek hybrid models respect external reasoning mode, latency routing takes effect without stale provider affinity, and desktop file previews finish with clear saved, failed, or unconfirmed states.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-7)

## [v0.1.6] — 2026-11-02

Liminal checks for complete releases at launch, downloads and verifies the app bundle, then installs and restarts automatically. Offline checks and skipped updates open the current version, with rollback and configuration preservation for installation failures.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-6)

## [v0.1.5] — 2026-11-02

Turn client enquiries into sourced proposals, receipt images into validated expense reviews, and bug reports into tested patches. Includes desktop and web entry points, downloadable deliverables, resumable runs, and reliable Windows terminal regression checks.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-5)

## [v0.1.4] — 2026-11-02

Choose individual OpenRouter models in desktop and web, keep agent work on one selected model, and avoid the extra classifier request before replies. Includes refreshed product screenshots and a rewritten README.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-4)

## [v0.1.3] — 2026-11-02

A consistent slate-and-iris interface, a rebuilt desktop hub, and streamlined settings with everyday controls first and searchable advanced options.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-3)

## [v0.1.2] — 2026-06-18

Scans all connected Gmail/Outlook mailboxes with account-aware replies, automated inbox watcher with Gmail labels, email privacy redaction, composer drag-and-drop for any file type, redesigned integrations panel on web and desktop, and managed inference Settings that stay on managed mode.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-2)

## [v0.1.1] — 2026-06-15

Portable Liminal Desktop installs can check GitHub Releases on launch, apply harness updates in place (liminald-runtime zip), and schedule full app updates with a one-time restart. CLI gains liminal update --check for portable installs.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-1)

## [v0.1.0] — 2026-06-15

First tagged public preview. Stabilization milestone: CI workflow on main, eval sandbox framework, inference latency mode, tool circuit for performance, desktop managed inference catalog, and sidecar multi-chat registry.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-1-0)

## [v0.0.26] — 2026-06-10

Ships immediate desktop compose preview for file edits and email drafts, rendered HTML in the email dock, expanded Azure Resource Manager REST tools with API-version inference, Kimchi/Cast AI provider throttling and retries, and OSC 133 shell-integration markers for deterministic agent-terminal command completion.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-26)

## [v0.0.25] — 2026-06-09

Ships a Flutter design system and polished Vireon hub + chat UI, harness-side Google/Linear/Sheets tool-arg normalization, automatic Sheets column/spacer sizing after writes, and a structural user-reply finalize pass so research turns end with a chat answer.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-25)

## [v0.0.24] — 2026-06-09

Adds hosted OAuth on vireondynamics.com for Google Workspace, Microsoft 365, GitHub, Slack, Linear, Notion, and Xero — no per-user app registration — plus hosted token refresh, custom GitHub website login, and a desktop-first integrations hub.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-24)

## [v0.0.23] — 2026-06-07

Adds Microsoft 365 OAuth + Graph REST + MCP sidecar, Google Workspace REST hybrid (Docs/Sheets/Slides/Calendar), GitHub connector, lazy tool-family loading, enterprise email compose (style infer, live preview dock, MIME repair, product-truth guards), desktop integrations hub, and sidecar orchestrator handoff.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-23)

## [v0.0.22] — 2026-06-07

Adds Serper-backed web search with DuckDuckGo fallback, agentcard harness tools, Gmail compose guard, embedded browser dock on desktop, default persona on bootstrap skip, and full liminal widget-app stack behind AGENT_LIMINAL_APPS=0 until stable.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-22)

## [v0.0.21] — 2026-06-06

Fixes stacked empty Plan cards with a single in-place progress tracker on web/TUI/desktop; adds session replay hydration, sidecar TTS/STT HTTP, desktop dictation, persona UI copy/layout/invariants, and provider token scrub.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-21)

## [v0.0.20] — 2026-06-06

Entity dossier tools (vault_ingest_entities, vault_recall, vault_lint), R-VAULT-ENTITIES protocol guidance, desktop Settings provider presets, and automatic OpenRouter BYOK fallback when managed credits are exhausted.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-20)

## [v0.0.19] — 2026-06-05

Ships pre-built Liminal Desktop for Windows, macOS (Apple Silicon), and Linux via GitHub Releases; portable liminald bundle; marketing install page with per-OS download cards.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-19)

## [v0.0.18] — 2026-06-04

Windows desktop app with sidecar protocol, rich assistant markdown/HTML, OpenRouter ignore-list recovery on long runs, and native Gmail read tools.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-18)

## [v0.0.17] — 2026-06-02

Team-tier org memory sync (workspace/global notes), Pro `/api/pro/cloud_sync/*`, harness NotesFacade + turn hooks, org RBAC and invites on the control plane.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-17)

## [v0.0.16] — 2026-06-02

Managed inference for Pro, Vireon sign-in, dynamic OpenRouter routing, EE auto-install, security hardening.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-16)

## [v0.0.15] — 2026-05-31

Open-core licensing, Vireon control plane, Enterprise Edition package, dynamic workflows.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-15)

## [v0.0.14] — 2026-05-30

LLM memory curator, output-effort dial, voice I/O, retrieval reranker, deeper prompt caching.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-14)

## [v0.0.13] — 2026-05-28



[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-13)

## [v0.0.12] — 2026-05-26

Research ledger, identity memory, FSL relicense, web chat chrome polish.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-12)

## [v0.0.11] — 2026-05-24

User-global storage, web multi-chat, audio transcription, and connector tools.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-11)

## [v0.0.10] — 2026-05-23

Task Worlds landed earlier on May 23 then was removed the same day in favor of execution state and compensation wiring.

[Full notes](https://docs.vireondynamics.com/liminal/reference/changelog#v0-0-10)

## [v0.0.9] — 2026-05-22

Streaming writes, reasoning budget, Playwright browser + CAPTCHA, document engine, license file (later FSL), compensation ledger.

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

---

Older entries: [docs changelog](https://docs.vireondynamics.com/liminal/reference/changelog).
