# Liminal documentation

Run, configure, and extend the Liminal agent harness (alpha v0.0.10).

**Published:** [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/)

## Recommended path

```text
Install → Quickstart → Configuration basics
    → Architecture + Harness protocol
    → Persona + Vault guides (when you use those features)
    → Environment reference (lookup) + Troubleshooting (when stuck)
```

## 1. Get running

| Step | Document |
|------|----------|
| Install (hosted scripts) | [Install](./start/install.md) |
| First session & smoke test | [Quickstart](./start/quickstart.md) |
| `.env` vs Settings vs defaults | [Configuration basics](./start/configuration-basics.md) |
| Something broke | [Troubleshooting](./operations/troubleshooting.md) |

**Install commands (hosted):**

```bash
curl -fsSL https://vireondynamics.com/install/install.sh | bash   # Linux / macOS / WSL
```

```powershell
irm https://vireondynamics.com/install/install.ps1 | iex          # Windows
```

## 2. Understand the harness

| Document | Contents |
|----------|----------|
| [Architecture](./concepts/architecture.md) | Packages, ReAct loop, dispatcher, locks |
| [Harness protocol](./concepts/harness-protocol.md) | R-* rules, web_fetch, large writes |
| [Runtime behavior](./concepts/runtime-behavior.md) | World context, drift, reflexion |
| [Identity stack](./concepts/identity-stack.md) | Persona vs harness vs base LLM |
| [UI streaming](./concepts/ui-streaming.md) | SSE, busy state, web HUD |

## 3. Persona & vault (operator guides)

| Document | Contents |
|----------|----------|
| [Persona system](./concepts/persona-system.md) | Bootstrap, soul slices, UI theme |
| [Persona bootstrap](./guides/persona-bootstrap.md) | First-run voice setup |
| [Memory and vault](./concepts/memory-and-vault.md) | Notes, Obsidian, dedupe |
| [Vault briefs](./guides/vault-briefs-and-updates.md) | `vault_write` without dedupe traps |

## 4. Reference

| Document | Contents |
|----------|----------|
| [Changelog](./reference/changelog.md) | Alpha release notes v0.0.1–v0.0.10 |
| [Roadmap](./reference/roadmap.md) | Alpha → beta → RC → v0.1.0 public preview |
| [Environment reference](./reference/environment.md) | Generated full `AGENT_*` table (`npm run docs:gen`) |
| [Configuration (narrative)](./configuration.md) | Flag groups by subsystem |
| [Tool families](./reference/tools/index.md) | Lazy loading catalog |
| [Web API](./reference/web-api.md) | REST + SSE |
| [Events](./reference/events.md) | Telemetry payloads |
| [Baseline profiles](./operations/profiles.md) | Recommended flag bundles |

## Contributors

- Source: [github.com/traidy2222/liminal-ai](https://github.com/traidy2222/liminal-ai)
- Agent-oriented map: root `CLAUDE.md` and `README.md`
- Local preview: `npm run docs:dev` in the monorepo
- After env key changes: `npm run docs:gen` · `npm run docs:check`
