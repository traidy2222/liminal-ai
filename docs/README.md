# Liminal documentation

Human-oriented guides for configuring, operating, and extending the Liminal agent harness and its interfaces.

## Start here

| Document | Contents |
|----------|----------|
| [Configuration](./configuration.md) | Environment variables by subsystem, recommended profiles |
| [Architecture](./architecture.md) | Packages, ReAct loop, dispatcher, orchestration, context, rule stats |
| [Harness protocol](./harness-protocol.md) | Named R-* rules, round-2 recall, coherence and web_fetch Readability behavior |
| [Runtime behavior](./runtime-behavior.md) | World context, drift, reflexion, vault policy, self-management |

## Tools and quality

| Document | Contents |
|----------|----------|
| [Memory and vault](./memory-and-vault.md) | Typed memory, Obsidian vault, retrieval order |
| [Research quality](./research-quality.md) | Web research, sources, synthesis |
| [Evaluation](./evaluation.md) | Eval runner and scenarios |
| [Troubleshooting](./troubleshooting.md) | Common failures and fixes |

## Interfaces and ops

| Document | Contents |
|----------|----------|
| [UI streaming](./ui-streaming.md) | TUI/web event model |
| [Telemetry and events](./telemetry-and-events.md) | Event payloads and observability |

## Mobile (optional)

| Document | Contents |
|----------|----------|
| [API contract (mobile)](./mobile/api_contract.md) | Backend contract notes |
| [Play Store readiness](./mobile/play_store_readiness.md) | Android release checklist |

## Repository developer note

`CLAUDE.md` at the monorepo root is the **agent-oriented** quick reference (commands, env tables, package map). These `docs/` pages are deeper narrative and cross-links; keep them in sync when adding major `AGENT_*` flags or harness behavior.
