# Liminal documentation

Run, configure, and extend the Liminal agent harness (alpha v0.0.19).

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

## 3. Capabilities (how-to guides)

| Document | Contents |
|----------|----------|
| [Persona system](./concepts/persona-system.md) · [Persona bootstrap](./guides/persona-bootstrap.md) | Voice, soul slices, UI theme, first-run setup |
| [Memory and vault](./concepts/memory-and-vault.md) · [Memory &amp; recall](./guides/memory-and-recall.md) · [Vault briefs](./guides/vault-briefs-and-updates.md) | Typed notes, hybrid recall, scopes, curation, Obsidian |
| [Web research](./guides/web-research.md) | `web_search` + parallel `web_fetch`, retrieval order |
| [Browser automation](./guides/browser-automation.md) | Playwright: navigate, snapshot, act, extract |
| [Document engine](./guides/document-engine.md) | PPTX / DOCX / PDF pipeline + quality gate |
| [Voice](./guides/voice.md) | TTS + dictation |
| [Sub-agents &amp; orchestration](./guides/sub-agents-and-orchestration.md) | `spawn_agent`, critics, shared context |
| [Dynamic workflows](./guides/dynamic-workflows.md) | Multi-phase parallel fan-out |
| [Reasoning &amp; effort](./guides/reasoning-and-effort.md) | Reasoning budget vs output effort vs routing |
| [Tuning via Settings](./guides/tuning-via-settings.md) | Change behavior without editing `.env` |
| [Running the eval suite](./guides/running-eval.md) | Regression-test the harness |

## 4. Pro &amp; Enterprise

| Document | Contents |
|----------|----------|
| [Pro &amp; Enterprise features](./reference/pro-and-enterprise.md) | Per-tier features, entitlements, control-plane API |
| [Accounts &amp; licensing](./guides/accounts-and-licensing.md) | Sign in, license storage, offline grace |
| [Managed inference](./guides/managed-inference.md) | Run with no API key (Pro) |
| [Enterprise Edition](./reference/enterprise-edition.md) | Open-core boundary, EE install + integrity |
| [License](./reference/license.md) | FSL-1.1-MIT (Community) + EE terms |

## 5. Reference

| Document | Contents |
|----------|----------|
| [Changelog](./reference/changelog.md) | Alpha release notes v0.0.1–v0.0.19 |
| [Roadmap](./reference/roadmap.md) | Alpha → beta → RC → v0.1.0 public preview |
| [Environment reference](./reference/environment.md) | Generated full `AGENT_*` table (`npm run docs:gen`) |
| [Configuration (narrative)](./configuration.md) | Flag groups by subsystem |
| [Tool families](./reference/tools/index.md) | Full family catalog + lazy loading |
| [Web API](./reference/web-api.md) | REST + SSE, auth, multi-chat, audio |
| [Events](./reference/events.md) | Telemetry payloads |
| [Baseline profiles](./operations/profiles.md) | Recommended flag bundles |

## Contributors

- Source: [github.com/traidy2222/liminal-ai](https://github.com/traidy2222/liminal-ai)
- Agent-oriented map: root `CLAUDE.md` and `README.md`
- Local preview: `npm run docs:dev` in the monorepo
- After env key changes: `npm run docs:gen` · `npm run docs:check`
