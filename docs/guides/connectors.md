# Connectors & Integrations hub

Liminal connects to external services through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com). Tokens are stored on your machine under `~/.liminal/oauth/`. The agent sees each connection as **tools** in the same ReAct loop as files, shell, and memory.

This is a **harness integration** path (Settings → Integrations). It is separate from signing into the marketing website for your Vireon account.

## Supported providers

| Provider | Guide | Agent families | Typical use |
| -------- | ----- | -------------- | ----------- |
| Google Workspace | [Google Workspace](./google-workspace.md) | `google_workspace` + MCP sidecar | Gmail, Calendar, Drive, Docs, Sheets, Slides |
| Microsoft 365 | [Microsoft 365](./microsoft-365.md) | `microsoft_365` + MCP | Outlook, Teams, Planner, Excel, OneDrive |
| Azure | [Azure](./azure.md) | `azure` | ARM resources, `@azure/mcp` |
| GitHub | [GitHub](./github.md) | `github` | Repos, issues, pull requests |
| Slack | [Slack](./slack.md) | `slack` | Channels, threads, post messages |
| Linear | [Linear](./linear.md) | `linear` | Issues, projects, teams |
| Notion | [Notion](./notion.md) | `notion` | Pages, databases |
| Xero | [Xero](./xero.md) | `xero` | Invoices, contacts, bills |
| YouTube | [YouTube](./youtube.md) | `youtube` | Channel, videos, analytics |

Catalog source: `packages/tools/src/integrations/core/integration_providers.ts`.

## Connect from the UI

### Desktop (recommended)

1. Open **Integrations** from the Vireon hub or Settings.
2. Pick a provider → **Connect** → complete OAuth in the browser tab.
3. When the tab shows **Connected**, close it. Tools register automatically for most providers.
4. For Google Workspace, click **Attach MCP tools** (or run `liminal connect google --attach`) after OAuth.

Per-account rows show connection status. Use **Revoke** on one account to disconnect it without removing other accounts for the same provider.

### Web UI

**Settings → Integrations** uses the same hosted OAuth handoff. `GET /api/integrations` returns a snapshot for the panel (`IntegrationsPanel.tsx`).

## Connect from the agent

```text
connect_provider({ provider: "slack", start_oauth: true })
list_connectors()
integrations_snapshot()
revoke_integration_account({ provider: "google", accountId: "..." })
```

| Tool | Purpose |
| ---- | ------- |
| `connect_provider` | Start OAuth or attach MCP for a provider |
| `disconnect_provider` | Remove a provider connection |
| `list_connectors` | Live status: OAuth accounts, MCP attach, **Connected mailboxes** |
| `integrations_snapshot` | Structured snapshot for the Integrations UI and debugging |
| `revoke_integration_account` | Remove **one** linked account without revoking every account for that provider |

Writes (post Slack message, send mail, create Xero bill) are **approval-gated** by default.

## Lazy loading

With `AGENT_TOOL_LAZY=1` (default), connector tool families stay off until:

- A provider is linked and `AGENT_INTEGRATION_AUTO_ACTIVATE=1` (default on), or
- The model calls `activate_tool_family("slack")` (etc.), or
- `list_connectors` / `connect_provider` runs.

The meta `connectors` family (`connect_provider`, `list_connectors`, …) is always reachable once integrations are enabled.

## Multi-account mail

Gmail and Microsoft support **multiple linked accounts**. Use [Multi-account mail](./multi-account-mail.md) for `mail_search_inboxes`, `account_hint`, and privacy redaction.

## Inbox automation

Background triage for Gmail and Outlook: [Inbox watcher](./inbox-watcher.md).

## Operator setup (Vireon hosted OAuth)

Each provider guide has a **Operator setup** section for the Vireon Cloud OAuth app (redirect URIs, scopes, Vercel env vars). End users on Community Edition do not need their own OAuth client.

Redirect pattern: `https://www.vireondynamics.com/connect/<provider>/callback` → loopback handoff to `POST /api/integrations/oauth/handoff`.

See [Web API — Integrations](../reference/web-api.md#integrations-oauth).

## OpenAPI and MCP (power users)

Beyond built-in connectors:

- `api_connect` — ingest OpenAPI 3.x → one tool per operation
- `mcp_attach` — Streamable-HTTP MCP server → `mcp_<conn>_<tool>` tools

Connections persist under `~/.liminal/api_connections/`. See [Tool families — external_api](../reference/tools/index.md).

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Tools missing after connect | `list_connectors`; `activate_tool_family` for the provider; reconnect if scopes changed |
| Gmail MCP permission errors | Enroll Cloud project in [Workspace Developer Preview](https://developers.google.com/workspace/preview); enable **Gmail MCP API** |
| Wrong mailbox used for reply | [Multi-account mail](./multi-account-mail.md) — `mail_search_inboxes` then `account_hint` |
| Entra guest admin mailbox appears | `mail_oauth_filter` skips `#EXT#` guest accounts; connect the real user mailbox |
| Disconnect one Google account | Integrations UI **Revoke** or `revoke_integration_account` |

See also [Troubleshooting](../operations/troubleshooting.md).
