# Liminal

Local-first agent runtime for tool-heavy software work — structured ReAct loop, strict tool dispatch, memory and vault integration, TUI and web UIs, and scenario-based evals. Built for reliability and debuggability, not demo polish.

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

## What you get

| Area | Highlights |
|------|------------|
| **Harness** | ReAct loop, retries, context compression, approval gates, optional self-heal lint |
| **Tools** | Files, shell, git, code intel, web (`web_search` + `web_fetch`), memory, Obsidian vault, orchestration |
| **State** | Epistemic subgoals, execution contracts, streaming events (TUI + SSE web) |
| **Quality** | `packages/eval` scenario packs; `npm run test` on core |

Liminal is a **runtime**, not a hosted SaaS or a thin chat wrapper. Destructive tools can require approval; use `--yolo` only in trusted environments.

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
| `npm run web:dev` | API :3001 + Vite :5173 |
| `npm run eval -w packages/eval` | Scenario evals |
| `npm run docs:dev` | Browse docs (VitePress) |

Workspace builds: `npm run build -w packages/core` then `packages/tools`. Eval filters: `npm run eval -w packages/eval -- --only memory`.

## Configuration

- **Secrets** — `AGENT_API_KEY` (and related) in `.env` only.
- **Everything else** — typed defaults in code, overridable via web **Settings** or `.agent_runtime_prefs.json`.
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

No top-level `LICENSE` file is present yet; add one before external distribution if needed.
