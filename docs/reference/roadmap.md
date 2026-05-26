# Roadmap

Where Liminal is today and what comes next. **Dates are directional, not commitments** — alpha moves fast on `main`.

**Current stage:** **alpha** (`v0.0.11`, May 2026). Beta, RC, and **v0.1.0 public preview** are [planned milestones](./changelog.md#planned-not-started), not shipped yet.

---

## Now — Alpha (v0.0.11)

What you can run today from [Install](../start/install.md):

| Area | Status |
|------|--------|
| ReAct harness | Retries, circuit breaker, compression, approvals, optional self-heal lint |
| Interfaces | Terminal UI (Ink) + Web UI (Express + React + SSE, multi-chat) |
| Tools | 140+ tools — files, shell, git, web, browser, memory, vault, documents, orchestration, OpenAPI/MCP attach |
| Persona | Bootstrap, soul slices, UI themes (web shells) |
| Storage | User-global `~/.liminal/` + per-chat workspaces (`AGENT_STORAGE_LAYOUT`) |
| Memory | Typed notes, hybrid recall, federation scoring, promote/neighbors, recipe library, optional auto-dream |
| Audio | `transcribe_audio`, web mic upload, dictation env knobs |
| Install | Hosted one-command scripts + `liminal` CLI (alpha onboarding) |
| Docs | Self-contained portal at [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/) |

See [Changelog](./changelog.md) for version-by-version notes.

---

## Beta — stability & defaults freeze

**Goal:** fewer surprises on upgrade; eval suite gates regressions before we call it beta.

| Focus | Target |
|-------|--------|
| Harness stability | Flake reduction across core + tools eval packs |
| Defaults freeze | Typed `HARNESS_ENV_DEFAULTS` treated as a compatibility surface |
| Install hardening | `liminal doctor`, wizard edge cases, clearer failure messages |
| Docs | Operator path complete (install → configure → troubleshoot) |
| Breaking changes | Called out in changelog; migration notes where needed |

**Not in beta scope:** npm global package, Docker images, or “GA” install channel — those stay on the v0.1.0 track.

---

## Release candidate (RC)

**Goal:** ship checklist passed; docs and env reference frozen for the release tag.

| Focus | Target |
|-------|--------|
| Release checklist | Build, typecheck, eval, manual TUI/web smoke |
| Docs freeze | Generated env reference + operator guides match the tag |
| Security pass | Approval paths, secret handling, default safety posture reviewed |
| Performance | Known hot paths documented (web_fetch walls, context compression) |

---

## v0.1.0 — public preview

**Goal:** first **tagged** public preview — not “latest `main`”, but a named release people can pin.

| Focus | Target |
|-------|--------|
| Version tag | `v0.1.0` on GitHub with release notes |
| Install GA | Hosted installers + CLI promoted from “alpha helper” to supported onboarding |
| Upgrade story | `liminal update` + documented migration from alpha installs |
| Eval bar | Scenario packs green on the release branch |

Still **local-first** and **MIT** — v0.1.0 is a stability/packaging milestone, not a hosted SaaS product.

---

## Exploring (no dates)

Ideas under investigation or early scaffolding — **not promised** for a specific release:

| Theme | Notes |
|-------|--------|
| **Team & sync** | Shared persona profiles, team vault patterns — see [pricing](https://vireondynamics.com/liminal/pricing) waitlist |
| **Mobile companion** | Android scaffold in repo; not a shipped client yet |
| **Packaging** | Docker, systemd/launchd, npm global — explicitly **not** in current install v1 |
| **Enterprise** | Air-gapped guidance, SSO help, custom tools — [contact](https://vireondynamics.com/about#contact) |

---

## Vireon Dynamics — beyond Liminal

Liminal is the only product you can install today. Vireon Dynamics names the rest of the pipeline on the marketing site so visitors know what the studio is building toward (no implied ship dates).

| Product | Status | What it is |
|---------|--------|------------|
| **Liminal AI** | Alpha · shipping | This repo — local-first harness + TUI/web |
| **Liminal for Teams** | In development | Shared personas, team vault patterns, audit-friendly session logs |
| **Liminal Mobile** | Early scaffold | Companion app for chat, approvals, and attachments against your harness |
| **Vireon Bench** | Research | CI-grade harness regression testing from the eval suite |
| **Harness SDK** | Research | Embed the loop in your own IDE, bot, or vertical agent |

- **Studio roadmap & waitlists:** [vireondynamics.com/roadmap](https://vireondynamics.com/roadmap)
- **All products:** [vireondynamics.com/products](https://vireondynamics.com/products)
- Future products may get their own docs at `docs.vireondynamics.com/<product>/` when they ship.

---

## How to follow along

- **Changelog:** [reference/changelog](./changelog.md) — what landed each alpha slice
- **GitHub:** [github.com/traidy2222/liminal-ai](https://github.com/traidy2222/liminal-ai) — source of truth for `main`
- **Liminal release phases:** [vireondynamics.com/liminal/roadmap](https://vireondynamics.com/liminal/roadmap) — alpha → beta → RC → v0.1.0
- **Studio product pipeline:** [vireondynamics.com/roadmap](https://vireondynamics.com/roadmap)

Want something prioritized? Open a [GitHub discussion](https://github.com/traidy2222/liminal-ai/discussions) or use the contact form on the marketing site.
