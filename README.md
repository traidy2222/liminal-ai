# Liminal AI — local agent harness for coding, research, and automation

[![License: FSL-1.1-MIT](https://img.shields.io/badge/License-FSL--1.1--MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

**Liminal** is a **model-agnostic AI agent harness** for serious software work: a structured ReAct loop with tool dispatch, persistent memory, sub-agents, and matching **terminal + web** UIs. Use any **OpenAI-compatible** API (OpenRouter, local LM Studio, DeepSeek, etc.) — no vendor lock-in, no opaque hosted middleman.

**Built by [Vireon Dynamics](https://www.vireondynamics.com)** · **[Install](https://www.vireondynamics.com/liminal/get-started)** · **[Pricing](https://www.vireondynamics.com/liminal/pricing)** · **[Docs](https://docs.vireondynamics.com/liminal/)** · **[Compare tools](https://www.vireondynamics.com/liminal/compare)**

> **Community Edition is free** under [FSL-1.1-MIT](LICENSE) — full harness on your machine. Optional **Pro / Team** add cloud memory sync and team features via [Vireon](https://www.vireondynamics.com/liminal/pricing).

![Liminal web UI mid-task — tool calls for write, shell, and streaming reply](assets/web-ui.png)

<p align="center"><em>Web UI mid-task: file writes, shell/type-check, and streamed answers — every tool call visible inline.</em></p>

## What you get

| | |
|---|---|
| **For** | Developers who want a **local, inspectable coding agent** — not a black-box chat tab |
| **Runs on** | Your machine (Linux, macOS, WSL, Windows) with **your** API keys |
| **Unlike** | Thin chat wrappers — Liminal is an **orchestration harness** with approvals, memory, evals, and document export |
| **License** | CE: [FSL-1.1-MIT](LICENSE) (fair-source; MIT on each version after 2 years). EE: commercial ([pricing](https://www.vireondynamics.com/liminal/pricing)) |

**Keywords people use:** open-source AI coding agent, local AI agent, OpenRouter agent, autonomous dev agent, ReAct harness, Obsidian vault agent, self-hosted coding assistant.

## Why Liminal

- **Model-agnostic** — any OpenAI-compatible endpoint; swap models without rewriting workflows.
- **Reliability-engineered** — retries, context compression, approval gates, drift scoring, resumable large-file writes; built to finish multi-step tasks.
- **Transparent** — terminal **and** web UI; stream every tool call, approval, and harness trace.
- **Knowledge that persists** — typed memory + hybrid BM25/vector recall; optional **Obsidian vault** integration.
- **Fair-source CE** — run the full Community Edition free; Pro/Team are optional hosted add-ons from Vireon.

**Requirements:** Node.js 22+, npm 10+, an OpenAI-compatible API key (OpenRouter works out of the box).

## Quick start (one command)

**Linux / macOS / WSL:**

```bash
curl -fsSL https://www.vireondynamics.com/install/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://www.vireondynamics.com/install/install.ps1 | iex
```

This clones the repo, runs setup, and can open the web UI with persona bootstrap. Full paths, CI, and troubleshooting → **[Install guide](https://www.vireondynamics.com/liminal/get-started)** · **[Docs: install](https://docs.vireondynamics.com/liminal/start/install)**.

**Already cloned this repository:**

```bash
npm install
npm run setup            # interactive wizard → .env + build
npm run web -- --bootstrap
# or
node scripts/liminal.mjs web -- --bootstrap --open
```

Minimal `.env` (if you skip the wizard):

```bash
AGENT_API_KEY=your_key_here
AGENT_API_BASE_URL=https://openrouter.ai/api/v1
AGENT_MODEL=deepseek/deepseek-chat
```

| Command | Purpose |
|---------|---------|
| `liminal setup` / `npm run setup` | First-run wizard |
| `liminal doctor` / `npm run doctor` | Verify install |
| `liminal web --bootstrap --open` | Web UI + browser |
| `liminal tui --bootstrap` | Terminal UI |
| `liminal update` | Pull + rebuild |

First session walkthrough → **[Quickstart](https://docs.vireondynamics.com/liminal/start/quickstart)** · **[Configuration basics](https://docs.vireondynamics.com/liminal/start/configuration-basics)**.

## Official site (Vireon Dynamics)

Use the marketing site for **install UX, pricing, comparisons, and release notes** (SEO-friendly guides that complement this repo):

| Page | URL |
|------|-----|
| **Liminal home** | [vireondynamics.com/liminal](https://www.vireondynamics.com/liminal) |
| **Get started** | [vireondynamics.com/liminal/get-started](https://www.vireondynamics.com/liminal/get-started) |
| **Pricing (Community / Pro / Team)** | [vireondynamics.com/liminal/pricing](https://www.vireondynamics.com/liminal/pricing) |
| **Compare vs other tools** | [vireondynamics.com/liminal/compare](https://www.vireondynamics.com/liminal/compare) |
| **Guides & use cases** | [Resources hub](https://www.vireondynamics.com/liminal/resources) |
| **Changelog (product)** | [vireondynamics.com/liminal/changelog](https://www.vireondynamics.com/liminal/changelog) |
| **Blog** | [vireondynamics.com/blog](https://www.vireondynamics.com/blog) |

### How Liminal compares (2026)

Honest side-by-side pages — local agent vs IDE copilots and chat tools:

| Alternative | Comparison |
|-------------|------------|
| Cursor | [Liminal vs Cursor](https://www.vireondynamics.com/liminal/compare/cursor) |
| Claude Code | [Liminal vs Claude Code](https://www.vireondynamics.com/liminal/compare/claude-code) |
| GitHub Copilot | [Liminal vs GitHub Copilot](https://www.vireondynamics.com/liminal/compare/github-copilot) |
| Windsurf | [Liminal vs Windsurf](https://www.vireondynamics.com/liminal/compare/windsurf) |
| Cline | [Liminal vs Cline](https://www.vireondynamics.com/liminal/compare/cline) |
| Aider | [Liminal vs Aider](https://www.vireondynamics.com/liminal/compare/aider) |
| Continue | [Liminal vs Continue](https://www.vireondynamics.com/liminal/compare/continue-dev) |
| OpenHands | [Liminal vs OpenHands](https://www.vireondynamics.com/liminal/compare/openhands) |

**All comparisons:** [liminal/compare](https://www.vireondynamics.com/liminal/compare)

## Capabilities

| Area | What's in the box |
|------|-------------------|
| **Reliable loop** | ReAct with retries, context compression, approval gates, drift scoring, optional post-edit self-heal lint |
| **Tools** | Files (resumable streaming writes), shell/processes, git, code intelligence (AST, symbols, tests, lint), web search + fetch, headless browser + CAPTCHA |
| **Knowledge** | Typed memory with hybrid BM25 + vector recall; Obsidian vault read/write/graph |
| **Autonomy** | Sub-agents, intra-round tool DAG, dynamic workflows, contract verification, reasoning-budget control |
| **Documents** | Optional PPTX / DOCX / PDF engine with layout lint and quality gate |
| **Personas** | Custom assistant voice + themed web shell from one prompt |
| **Quality** | Eval packs in `packages/eval`; extensive `core` unit tests |

Liminal is a **harness you run**, not a hosted SaaS. Destructive tools can require approval; use `--yolo` only in trusted environments.

![First-run persona bootstrap — voice, presets, themed UI shell](assets/persona-bootstrap.png)

<p align="center"><em>Persona bootstrap: describe how the assistant should sound; Liminal generates tone and UI chrome — tools and safety unchanged.</em></p>

## Repository layout

```text
packages/
  core/           Harness engine (build → dist/)
  tools/          Tool implementations (depends on core)
  tui/            Ink terminal UI
  web/            Express + React + SSE
  eval/           Evaluation scenarios
  enterprise/     Enterprise Edition (EE) — proprietary
  control-plane/  Billing + license issuance (deploy with vireondynamics-website)
```

> **Community Edition (CE):** `core`, `tools`, `tui`, `web` — [FSL-1.1-MIT](LICENSE).  
> **Enterprise Edition (EE):** `enterprise` — proprietary; see [License](#license) and [pricing](https://www.vireondynamics.com/liminal/pricing).

Build order: **core → tools** before tui/web/eval. Contributor invariants → **`CLAUDE.md`**.

## Commands (contributors)

| Command | Purpose |
|---------|---------|
| `npm run setup` | Interactive wizard (`.env`, install, build) |
| `npm run doctor` | Verify Node, builds, API key |
| `npm run build` | Compile core + tools |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run test` | Core unit tests |
| `npm run tui` / `npm run web` | Run interfaces |
| `npm run web:dev` | API :3001 + Vite dev |
| `npm run eval -w packages/eval` | Scenario evals |
| `npm run docs:dev` | Local VitePress docs |

Eval filters: `npm run eval -w packages/eval -- --only memory`.

## Configuration

- **Secrets** — `AGENT_API_KEY` in `.env` only (never commit).
- **Product defaults** — typed harness constants + web **Settings** or `.agent_runtime_prefs.json`.
- **Full key list** — [environment reference](docs/reference/environment.md) (`npm run docs:gen` after inventory changes).

Narrative overview: [docs/configuration.md](docs/configuration.md) · Profiles: [docs/operations/profiles.md](docs/operations/profiles.md).

## Documentation

**Published (always current for operators):** [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/)

| If you need… | Start here |
|--------------|------------|
| One-command install | [install](https://docs.vireondynamics.com/liminal/start/install) · [Marketing install](https://www.vireondynamics.com/liminal/get-started) |
| First session | [quickstart](https://docs.vireondynamics.com/liminal/start/quickstart) |
| Troubleshooting | [troubleshooting](https://docs.vireondynamics.com/liminal/operations/troubleshooting) |
| Architecture | [architecture](https://docs.vireondynamics.com/liminal/concepts/architecture) · [harness protocol](https://docs.vireondynamics.com/liminal/concepts/harness-protocol) |
| Web research | [research with web tools](https://docs.vireondynamics.com/liminal/guides/research-with-web-tools) |
| Obsidian / vault | [vault briefs](https://docs.vireondynamics.com/liminal/guides/vault-briefs-and-updates) |

Edit docs locally: `npm run docs:dev`. Product changelog on the site: [liminal/changelog](https://www.vireondynamics.com/liminal/changelog).

## Contributing

- Keep **`core`** free of **`tools`** imports; rebuild core after harness changes.
- Run `npm run typecheck` and `npm run test` before PRs.
- Docs: `npm run docs:gen` when changing managed `AGENT_*` keys; `npm run docs:check` when editing `docs/`.

Details: **`CLAUDE.md`** · **[docs/README.md](docs/README.md)**

## License & commercial use

Liminal is **open-core**:

- **Community Edition (CE)** — `packages/core`, `tools`, `tui`, `web` — [Functional Source License 1.1, MIT Future License](LICENSE) (FSL-1.1-MIT). CE is fully functional standalone. Summary: [docs/reference/license.md](docs/reference/license.md).
- **Enterprise Edition (EE)** — `packages/enterprise` — proprietary ([LICENSE-EE](packages/enterprise/LICENSE-EE)); requires a valid license entitlement (`packages/core/src/entitlements.ts`). **Pro / Team subscriptions:** [vireondynamics.com/liminal/pricing](https://www.vireondynamics.com/liminal/pricing) · **License key:** [account](https://www.vireondynamics.com/account/license).

FSL in brief:

- **Permitted:** internal commercial use, education/research, professional services for licensees, and other non–Competing Use purposes.
- **Not permitted:** products or services that substitute for Liminal or offer substantially similar functionality.
- **Future MIT:** each CE version also becomes MIT on the second anniversary of its first publication.

FSL is fair-source, not OSI “open source.” For enterprise, OEM/embed, or competing-use licensing → **[Vireon Dynamics](https://www.vireondynamics.com)** · [contact](https://www.vireondynamics.com/about).
