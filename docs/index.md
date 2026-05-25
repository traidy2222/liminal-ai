# Liminal documentation

Human-oriented guides for running, configuring, and extending the Liminal agent harness.

**Published (alpha):** [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/) — built from this folder via the [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website) docs portal. **Changelog:** [reference/changelog](./reference/changelog.md).

**Last doc pass:** aligned with typed harness defaults, web Settings API, removed `web_research` tool, vault dedupe fixes, and SSE busy-state behavior.

## I want to run Liminal

| Document | Contents |
|----------|----------|
| [Install](./start/install.md) | One-command install, `liminal` CLI, paths |
| [Quickstart](./start/quickstart.md) | Manual install, build, `npm run tui` / `web` |
| [Configuration basics](./start/configuration-basics.md) | `.env` vs Settings vs defaults |
| [Troubleshooting](./operations/troubleshooting.md) | Common failures |

## I want to configure it

| Document | Contents |
|----------|----------|
| [Changelog](./reference/changelog.md) | Alpha release notes (v0.0.1–v0.0.10) |
| [Environment reference](./reference/environment.md) | **Generated** full `AGENT_*` table (`npm run docs:gen`) |
| [Configuration reference](./configuration.md) | Narrative flag groups by subsystem |
| [Tuning via Settings](./guides/tuning-via-settings.md) | Web Settings modal |
| [Baseline profiles](./operations/profiles.md) | Recommended flag bundles |
| [Web API](./reference/web-api.md) | REST + SSE endpoints |

## I want to understand the system

| Document | Contents |
|----------|----------|
| [Architecture](./concepts/architecture.md) | Packages, ReAct loop, dispatcher, locks |
| [Harness protocol](./concepts/harness-protocol.md) | R-* rules, web_fetch readability |
| [Runtime behavior](./concepts/runtime-behavior.md) | World context, drift, reflexion |
| [Identity stack](./concepts/identity-stack.md) | Persona vs harness vs base LLM |
| [Memory and vault](./concepts/memory-and-vault.md) | Notes, Obsidian, dedupe |
| [Persona system](./concepts/persona-system.md) | Bootstrap, soul slices, UI theme |
| [UI streaming](./concepts/ui-streaming.md) | SSE, busy state, artifacts |
| [Events](./reference/events.md) | Telemetry payloads |

## Task guides

| Document | Contents |
|----------|----------|
| [Research with web tools](./guides/research-with-web-tools.md) | `web_search` + `web_fetch` |
| [Vault briefs and updates](./guides/vault-briefs-and-updates.md) | `vault_write` without dedupe traps |
| [Persona bootstrap](./guides/persona-bootstrap.md) | First-run voice setup |
| [Running eval](./guides/running-eval.md) | `npm run eval` |
| [Research quality](./guides/research-quality.md) | Synthesis checklist |
| [Writing large files](./guides/writing-large-files.md) | Multi-part `write_file` / `append_file` |

## Tools

| Document | Contents |
|----------|----------|
| [Tool families](./reference/tools/index.md) | Lazy loading catalog |

## Contributors

See repository root `README.md` and `CLAUDE.md`.

**Browse locally:** `npm run docs:dev` — VitePress with sidebar search.

**Maintenance:** `npm run docs:gen` · `npm run docs:check`
