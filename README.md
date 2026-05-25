# Liminal

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![Node](https://img.shields.io/badge/Node-22%2B-339933?logo=node.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)

**A model-agnostic agent harness for tool-heavy software work.**

Liminal is the orchestration layer around the model — a structured ReAct loop with strict
tool dispatch, persistent memory, sub-agent orchestration, and matching terminal and web
UIs. Point it at any OpenAI-compatible API (OpenRouter, a local LM Studio model, anything
that speaks the protocol) and run it yourself. Built for reliability and observability,
not demo polish.

![Liminal's web UI mid-task — calling tools to write and type-check a file, then streaming the answer back](assets/web-ui.png)

<p align="center"><em>The web UI mid-task: writing a file, type-checking it through the shell, and streaming the result back — with every tool call shown inline.</em></p>

## Why Liminal

- **Model-agnostic** — bring any OpenAI-compatible endpoint; no vendor lock-in, no hosted middleman.
- **Reliability-engineered** — retries, context compression, approval gates, drift scoring, and resumable writes; the loop is built not to fall over mid-task.
- **Yours to run and inspect** — a transparent process on your machine with a terminal *and* web UI, streaming every tool call and state change as it happens.

**Requirements:** Node.js 22+, npm 10+, an OpenAI-compatible API (OpenRouter by default).

## Quick start

**One command (Linux / macOS / WSL):**

```bash
curl -fsSL https://raw.githubusercontent.com/traidy2222/liminal-ai/main/scripts/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/traidy2222/liminal-ai/main/scripts/install.ps1 | iex
```

Clones Liminal, runs setup, opens the web UI with persona bootstrap. See **[Install guide](https://docs.vireondynamics.com/liminal/start/install)** for paths, CI, and troubleshooting.

**Already have the repo:**

```bash
npm install
npm run setup            # interactive wizard → .env + build
npm run web -- --bootstrap
# or
node scripts/liminal.mjs web --bootstrap --open
```

Minimal `.env` (if not using the wizard):

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

Step-by-step setup, Settings vs `.env`, and profiles → **[Quickstart](https://docs.vireondynamics.com/liminal/start/quickstart)** · **[Install](https://docs.vireondynamics.com/liminal/start/install)** · **[Configuration basics](https://docs.vireondynamics.com/liminal/start/configuration-basics)**.

## Capabilities

| Area | What's in the box |
|------|-------------------|
| **Reliable loop** | ReAct loop with retries, context compression, approval gates for destructive tools, drift scoring, optional post-edit self-heal lint |
| **Tools** | Files (incl. resumable streaming large-file writes), shell and processes, git, code intelligence (AST, symbols, tests, lint), web search + fetch, headless browser automation with CAPTCHA solving |
| **Knowledge** | Typed memory with hybrid BM25 + vector recall; Obsidian vault read / write / graph |
| **Autonomy** | Sub-agent orchestration, intra-round dispatch DAG, contract verification, per-turn reasoning-budget control |
| **Documents** | Optional engine that renders PPTX / DOCX / PDF through an internal IR with layout linting and a quality gate |
| **Personas** | Generate a custom assistant — voice, behavior, and a themed web shell — from a single prompt |
| **State & streaming** | Epistemic subgoals, execution contracts, live token and tool streaming over the TUI and the SSE web client |
| **Quality** | Scenario-based eval packs in `packages/eval`; unit tests on `core` |

Liminal is a **harness you run**, not a hosted SaaS or a thin chat wrapper. Destructive
tools can require approval; use `--yolo` only in trusted environments.

![Liminal's first-run persona setup — describe how the assistant should sound, or pick a quick-start preset](assets/persona-bootstrap.png)

<p align="center"><em>First-run persona bootstrap: describe a voice (or tap a preset) and Liminal generates a matching assistant — tone and a themed UI shell, with tools and safety unchanged.</em></p>

## Repository

```text
packages/
  core/   Harness engine (build → dist/)
  tools/  Tool implementations (depends on core)
  tui/    Ink terminal UI
  web/    Express + React + SSE
  eval/   Evaluation scenarios
```

Build order: **core → tools** before running tui/web/eval. Contributor commands and invariants → **`CLAUDE.md`**.

## Commands

| Command | Purpose |
|---------|---------|
| `npm run setup` | Interactive first-run wizard (`.env`, install, build) |
| `npm run doctor` | Verify Node, builds, API key |
| `npm run build` | Compile core + tools |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run test` | Core unit tests |
| `npm run tui` / `npm run web` | Run interfaces |
| `npm run web:dev` | API :3001 + Vite :5173 |
| `npm run eval -w packages/eval` | Scenario evals |
| `npm run docs:dev` | Browse docs (VitePress) |

Workspace builds: `npm run build -w packages/core` then `packages/tools`. Eval filters: `npm run eval -w packages/eval -- --only memory`.

## Configuration

- **Secrets** — `AGENT_API_KEY` (and related) in `.env` only.
- **Everything else** — typed defaults in code, overridable via web **Settings** or `.agent_runtime_prefs.json` (local, gitignored).
- **Full key list** — [docs/reference/environment.md](docs/reference/environment.md) (`npm run docs:gen` after inventory changes).

Narrative flag groups: [docs/configuration.md](docs/configuration.md). Baseline bundles: [docs/operations/profiles.md](docs/operations/profiles.md).

## Documentation

**Published:** [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/) (alpha — synced from this repo’s `docs/` folder).

| If you need… | Start here |
|--------------|------------|
| One-command install | [install](https://docs.vireondynamics.com/liminal/start/install) |
| Install & first session | [quickstart](https://docs.vireondynamics.com/liminal/start/quickstart) |
| Stuck UI, vault, web_fetch | [troubleshooting](https://docs.vireondynamics.com/liminal/operations/troubleshooting) |
| Architecture & protocol | [architecture](https://docs.vireondynamics.com/liminal/concepts/architecture) · [harness protocol](https://docs.vireondynamics.com/liminal/concepts/harness-protocol) |
| Web research workflow | [research with web tools](https://docs.vireondynamics.com/liminal/guides/research-with-web-tools) |
| Vault briefs / updates | [vault briefs](https://docs.vireondynamics.com/liminal/guides/vault-briefs-and-updates) |

Edit locally: `npm run docs:dev` in this repo. Changelog and blog: [vireondynamics.com](https://vireondynamics.com).

## Contributing

- Keep **`core`** free of **`tools`** imports; rebuild core after harness changes.
- Run `npm run typecheck` and `npm run test` before PRs.
- Docs: `npm run docs:gen` when changing managed `AGENT_*` keys; `npm run docs:check` when editing `docs/`.

Details: **`CLAUDE.md`** (agents) · **[docs/README.md](docs/README.md)** (operators).

## License

Liminal is released under the [MIT License](LICENSE).
