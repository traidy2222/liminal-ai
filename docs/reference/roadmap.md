# Roadmap

Where Liminal is today and what comes next. **Dates are directional, not commitments** — we ship fast on `main`.

**Current stage:** **beta** (`v0.1.2` public preview, June 2026). [RC](#release-candidate-rc) and **install GA** are [planned](./changelog.md#planned), not shipped yet.

---

## Now — Beta (v0.1.2)

What you can run today from [Install](../start/install.md):

| Area | Status |
|------|--------|
| ReAct harness | Retries, circuit breaker, compression, approvals, optional self-heal lint |
| Interfaces | **Desktop** (Windows / macOS / Linux, Flutter + sidecar) + Web UI (Express + React + SSE, multi-chat) + Terminal UI (Ink) |
| Tools | 500+ catalog tools (300+ with MCP sidecars); lazy family loading — files, shell, git, web, browser, memory, vault, documents, orchestration, Google/Microsoft/Azure/GitHub/Slack/Linear/Notion/Xero/YouTube connectors, OpenAPI/MCP attach |
| Inference | **BYOK** (any OpenAI-compatible provider) or **Pro managed** via Vireon proxy — `liminal login`, `AGENT_INFERENCE_MODE` |
| Provider routing | Price-sorted OpenRouter resellers, Kimchi/Cast AI, sticky sessions, 429-aware rotation (`AGENT_PROVIDER_STRATEGY`) |
| Licensing | Open-core CE (FSL-1.1-MIT, no account) + offline Ed25519 tiers; EE auto-install on Pro login |
| Workflows | `plan_workflow` / `run_workflow` — multi-phase parallel sub-agents, out-of-context store |
| Persona | Bootstrap, soul slices, UI themes (web shells) |
| Storage | User-global `~/.liminal/` + per-chat workspaces (`AGENT_STORAGE_LAYOUT`) |
| Memory | Typed notes, hybrid recall, curator + soft-delete archive, federation, recipe library, optional auto-dream |
| Research | Per-send research ledger + `research_state` tool (web search/fetch discipline) |
| Audio / voice | `transcribe_audio`, TTS (`speak`), web dictation, voice-mode tool gating |
| Install | Hosted one-command scripts + `liminal` CLI + desktop installers |
| Quality gates | CI on main (build, typecheck, core tests); eval sandbox framework (`npm run eval:sandbox`) |
| Settings | Full `AGENT_*` catalog in web UI + managed inference model picker on desktop |
| Docs | Self-contained portal at [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/) |

See [Changelog](./changelog.md) for version-by-version notes.

---

## Alpha history (v0.0.1–v0.0.26)

Rapid iteration on `main` through June 2026 — desktop design system, hosted OAuth connectors, compose dock, Azure ARM, Kimchi provider, and work-integration tooling. Summarized in the [changelog](./changelog.md#v0-0-26).

---

## Beta — ongoing stability work

**Goal:** fewer surprises on upgrade; eval suite gates regressions before we call the next milestone RC.

| Focus | Target |
|-------|--------|
| Harness stability | Flake reduction across core + tools eval packs |
| Defaults freeze | Typed `HARNESS_ENV_DEFAULTS` treated as a compatibility surface |
| Install hardening | `liminal doctor`, wizard edge cases, clearer failure messages |
| Docs | Operator path complete (install → configure → troubleshoot) |
| Breaking changes | Called out in changelog; migration notes where needed |
| CI expansion | Tools, sidecar, eval sandbox smoke in CI |

**Not in beta scope:** npm global package, Docker images, or full install GA — those stay on the post-RC track.

---

## Release candidate (RC)

**Goal:** ship checklist passed; docs and env reference frozen for the release tag.

| Focus | Target |
|-------|--------|
| Release checklist | Build, typecheck, eval, manual TUI/web/desktop smoke |
| Docs freeze | Generated env reference + operator guides match the tag |
| Security pass | Approval paths, secret handling, default safety posture reviewed |
| Performance | Known hot paths documented (web_fetch walls, context compression) |

---

## Install GA (post-RC)

**Goal:** hosted installers and CLI promoted from “public preview” to a supported GA onboarding channel.

| Focus | Target |
|-------|--------|
| Upgrade story | `liminal update` + documented migration from preview installs |
| Eval bar | Scenario packs green on the release branch |
| Packaging | Explore bundled `liminald` (no external Node dependency) |

Still **local-first** and **FSL-1.1-MIT** (fair source; converts to MIT after two years per release).

---

## Exploring (no dates)

Ideas under investigation or early scaffolding — **not promised** for a specific release:

| Theme | Notes |
|-------|--------|
| **Team & sync** | Shared persona profiles, team vault patterns — see [pricing](https://vireondynamics.com/liminal/pricing) waitlist |
| **Packaging** | Docker, systemd/launchd, npm global — explicitly **not** in current install v1 |
| **Enterprise** | Air-gapped guidance, SSO help, custom tools — [contact](https://vireondynamics.com/about#contact) |

---

## Vireon Dynamics — beyond Liminal

Liminal is the only product you can install today. Vireon Dynamics names the rest of the pipeline on the marketing site so visitors know what the studio is building toward (no implied ship dates).

| Product | Status | What it is |
|---------|--------|------------|
| **Liminal AI** | Beta · shipping | This repo — local-first harness + desktop/web/TUI |
| **Liminal for Teams** | Beta (since v0.0.17) | Org-scoped shared memory sync; fleet/audit/policy governance still planned |
| **Vireon Bench** | Research | CI-grade harness regression testing from the eval suite |
| **Harness SDK** | Research | Embed the loop in your own IDE, bot, or vertical agent |

- **Studio roadmap & waitlists:** [vireondynamics.com/roadmap](https://vireondynamics.com/roadmap)
- **All products:** [vireondynamics.com/products](https://vireondynamics.com/products)
- Future products may get their own docs at `docs.vireondynamics.com/<product>/` when they ship.

---

## How to follow along

- **Changelog:** [reference/changelog](./changelog.md) — what landed each release slice
- **GitHub:** [github.com/traidy2222/liminal-ai](https://github.com/traidy2222/liminal-ai) — source of truth for `main`
- **Liminal release phases:** [vireondynamics.com/liminal/roadmap](https://vireondynamics.com/liminal/roadmap) — beta → RC → install GA
- **Studio product pipeline:** [vireondynamics.com/roadmap](https://vireondynamics.com/roadmap)

Want something prioritized? Open a [GitHub discussion](https://github.com/traidy2222/liminal-ai/discussions) or use the contact form on the marketing site.
