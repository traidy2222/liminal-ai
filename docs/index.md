# Liminal documentation

Run, configure, and extend the Liminal agent harness (beta **v0.1.2**).

**Published:** [docs.vireondynamics.com/liminal/](https://docs.vireondynamics.com/liminal/)

## Recommended path

```text
Install → Quickstart → Configuration basics
    → Connectors (if you use Gmail, Slack, Xero, etc.)
    → Architecture + Harness protocol
    → Persona + Vault guides (when you use those features)
    → Environment reference (lookup) + Troubleshooting (when stuck)
```

## 1. Get running

| Step | Document |
|------|----------|
| Install (CLI + desktop + auto-update) | [Install](./start/install.md) |
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
| [Rich message rendering](./concepts/rich-message-rendering.md) | Markdown, HTML embeds, images in chat |
| [Liminal desktop apps](./concepts/liminal-apps.md) | `spawn_app` OS widgets (gated by `AGENT_LIMINAL_APPS`) |

## 3. Integrations & work tools

| Document | Contents |
|----------|----------|
| [Connectors hub](./guides/connectors.md) | Hosted OAuth, Integrations UI, agent tools |
| [Multi-account mail](./guides/multi-account-mail.md) | `mail_search_inboxes`, `account_hint`, redaction |
| [Inbox watcher](./guides/inbox-watcher.md) | Background Gmail/Outlook triage |
| [Compose dock & attachments](./guides/compose-dock-and-attachments.md) | Live file/email preview, drag-drop files |
| [Google Workspace](./guides/google-workspace.md) | Gmail, Calendar, Drive, Docs, Sheets |
| [Microsoft 365](./guides/microsoft-365.md) | Outlook, Teams, Excel, OneDrive |
| [Azure](./guides/azure.md) | ARM + Azure MCP |
| [GitHub](./guides/github.md) | Repos, issues, PRs |
| [Slack](./guides/slack.md) | Channels, threads, post messages |
| [Linear](./guides/linear.md) | Issues, projects |
| [Notion](./guides/notion.md) | Pages, databases |
| [Xero](./guides/xero.md) | Invoices, contacts, bills |
| [YouTube](./guides/youtube.md) | Channel, videos, analytics |

## 4. Capabilities (how-to guides)

| Document | Contents |
|----------|----------|
| [Persona system](./concepts/persona-system.md) · [Persona bootstrap](./guides/persona-bootstrap.md) | Voice, soul slices, UI theme, first-run setup |
| [Memory and vault](./concepts/memory-and-vault.md) · [Memory & recall](./guides/memory-and-recall.md) · [Vault briefs](./guides/vault-briefs-and-updates.md) | Typed notes, hybrid recall, scopes, curation, Obsidian |
| [Web research](./guides/web-research.md) | `web_search` + parallel `web_fetch`, retrieval order |
| [Browser automation](./guides/browser-automation.md) | Playwright: navigate, snapshot, act, extract |
| [Document engine](./guides/document-engine.md) | PPTX / DOCX / PDF pipeline + quality gate |
| [Voice](./guides/voice.md) | TTS + dictation |
| [Sub-agents & orchestration](./guides/sub-agents-and-orchestration.md) | `spawn_agent`, critics, shared context |
| [Dynamic workflows](./guides/dynamic-workflows.md) | Multi-phase parallel fan-out |
| [Reasoning & effort](./guides/reasoning-and-effort.md) | Reasoning budget vs output effort vs routing |
| [Tuning via Settings](./guides/tuning-via-settings.md) | Change behavior without editing `.env` |
| [Running the eval suite](./guides/running-eval.md) | Regression-test the harness |
| [Sandbox capability lab](./guides/sandbox-capability-lab.md) | Isolated eval fixtures |
| [Agentcard](./guides/agentcard.md) | Virtual cards, agent email, x402 payments |
| [Remote sessions](./guides/remote-sessions.md) | Control a remote harness over the wire |
| [Team memory](./guides/team-memory.md) · [Team memory testing](./guides/team-memory-testing.md) | Shared notes across Team tier |

## 5. Pro & Enterprise

| Document | Contents |
|----------|----------|
| [Pro & Enterprise features](./reference/pro-and-enterprise.md) | Per-tier features, entitlements, control-plane API |
| [Accounts & licensing](./guides/accounts-and-licensing.md) | Sign in, license storage, offline grace |
| [Managed inference](./guides/managed-inference.md) | Run with no API key (Pro) |
| [Enterprise features](./guides/enterprise-features.md) | SSO, fleet, policy (operator guide) |
| [Enterprise Edition](./reference/enterprise-edition.md) | Open-core boundary, EE install + integrity |
| [License](./reference/license.md) | FSL-1.1-MIT (Community) + EE terms |

## 6. Reference

| Document | Contents |
|----------|----------|
| [Changelog](./reference/changelog.md) | Release notes through **v0.1.2** |
| [Roadmap](./reference/roadmap.md) | Beta → RC → install GA |
| [Environment reference](./reference/environment.md) | Generated full `AGENT_*` table (`npm run docs:gen`) |
| [Configuration (narrative)](./configuration.md) | Flag groups by subsystem |
| [Tool families](./reference/tools/index.md) | Full family catalog + lazy loading |
| [Web API](./reference/web-api.md) | REST + SSE, auth, multi-chat, integrations |
| [Events](./reference/events.md) | Telemetry payloads |
| [Inference path validation](./reference/inference-path-validation.md) | Diagnose routing / managed inference |
| [Baseline profiles](./operations/profiles.md) | Recommended flag bundles |

## Contributors

- Source: [github.com/traidy2222/liminal-ai](https://github.com/traidy2222/liminal-ai)
- Agent-oriented map: root `CLAUDE.md` and `README.md`
- Local preview: `npm run docs:dev` in the monorepo
- After env key changes: `npm run docs:gen` · `npm run docs:check`
- Publish to production: in [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website) run `npm run docs-portal:sync` and deploy `docs-portal`
