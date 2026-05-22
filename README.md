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

```bash
npm install
cp .env.example .env   # set AGENT_API_KEY, AGENT_MODEL
npm run build
npm run tui            # terminal UI
# or
npm run web            # http://localhost:3001 (PORT in .env)
```

Minimal `.env`:

```bash
AGENT_API_KEY=your_key_here
AGENT_API_BASE_URL=https://openrouter.ai/api/v1
AGENT_MODEL=qwen/qwen3.5-9b
```

First-run persona overlay: `npm run tui -- --bootstrap` or `npm run web -- --bootstrap`.

Step-by-step setup, Settings vs `.env`, and profiles → **[docs/start/quickstart.md](docs/start/quickstart.md)** · **[docs/start/configuration-basics.md](docs/start/configuration-basics.md)**.

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
| `npm run build` | Compile core + tools |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run test` | Core unit tests |
| `npm run tui` / `npm run web` | Run interfaces |
| `npm run web:dev` | API :3001 + Vite :3000 |
| `npm run eval -w packages/eval` | Scenario evals |
| `npm run docs:dev` | Browse docs (VitePress) |

Workspace builds: `npm run build -w packages/core` then `packages/tools`. Eval filters: `npm run eval -w packages/eval -- --only memory`.

## Configuration

- **Secrets** — `AGENT_API_KEY` (and related) in `.env` only.
- **Everything else** — typed defaults in code, overridable via web **Settings** or `.agent_runtime_prefs.json` (local, gitignored).
- **Full key list** — [docs/reference/environment.md](docs/reference/environment.md) (`npm run docs:gen` after inventory changes).

Narrative flag groups: [docs/configuration.md](docs/configuration.md). Baseline bundles: [docs/operations/profiles.md](docs/operations/profiles.md).

## Documentation

**[docs/README.md](docs/README.md)** — hub by intent (run · configure · understand · contribute).

| If you need… | Start here |
|--------------|------------|
| Install & first session | [quickstart](docs/start/quickstart.md) |
| Stuck UI, vault, web_fetch | [troubleshooting](docs/operations/troubleshooting.md) |
| Architecture & protocol | [architecture](docs/concepts/architecture.md) · [harness protocol](docs/concepts/harness-protocol.md) |
| Web research workflow | [research with web tools](docs/guides/research-with-web-tools.md) |
| Vault briefs / updates | [vault briefs](docs/guides/vault-briefs-and-updates.md) |

Optional local site: `npm run docs:dev`.

## Contributing

- Keep **`core`** free of **`tools`** imports; rebuild core after harness changes.
- Run `npm run typecheck` and `npm run test` before PRs.
- Docs: `npm run docs:gen` when changing managed `AGENT_*` keys; `npm run docs:check` when editing `docs/`.

Details: **`CLAUDE.md`** (agents) · **[docs/README.md](docs/README.md)** (operators).

## License

Liminal is released under the [MIT License](LICENSE).
