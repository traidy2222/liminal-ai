# Google Workspace integration

Liminal connects to Google Workspace through a **hybrid MCP architecture**:

- **Official Google MCP** (preview): Drive, Gmail, Calendar, Chat, People
- **Community sidecar** (`workspace-mcp` via `uvx`): Docs, Sheets, Slides, Forms, Tasks, Contacts, Apps Script, Custom Search

## Connect once (recommended)

One-time **Google Cloud** setup, then one CLI command. After that, tokens and MCP connections persist under `~/.liminal/`.

### 1. Google Cloud (one time)

In [Google Cloud Console](https://console.cloud.google.com/) for your OAuth project:

1. **APIs & Services → Library** — enable **both** the classic API and the **MCP** API for each official service:

   | You want | Classic API (REST) | **Also enable (MCP tools)** |
   |----------|-------------------|------------------------------|
   | Gmail | Gmail API | **Gmail MCP API** (`gmailmcp.googleapis.com`) |
   | Drive | Google Drive API | **Drive MCP API** (`drivemcp.googleapis.com`) |
   | Calendar | Google Calendar API | **Calendar MCP API** (`calendarmcp.googleapis.com`) |
   | Chat | Google Chat API | **Chat MCP API** (`chatmcp.googleapis.com`) |

   Gmail uses **`mcp_google_gmail_*`** tools against `gmailmcp.googleapis.com`. Enable **Gmail MCP API** in addition to Gmail API.

   Sidecar (Docs/Sheets/…): Google Docs API, Sheets API, Slides API, Forms API, Tasks API, People API.
2. **OAuth consent screen** — add test users if app is in *Testing* mode. Under **Data access**, manually add Google's **MCP** scopes (not only the classic REST scopes). Minimum for Gmail MCP: `gmail.readonly` + `gmail.compose` ([Google doc](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)).
3. **Workspace Developer Preview (required for MCP)** — Gmail/Drive/Calendar **MCP** APIs are preview-only. Enroll your Cloud project at [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview) (Workspace account + Cloud project). Until Google confirms enrollment, `tools/call` on `gmailmcp.googleapis.com` often returns *The caller does not have permission* even when classic Gmail API returns 200 and OAuth includes `gmail.compose`.
4. **Credentials → OAuth 2.0 Client** (Web or Desktop).
5. Add authorized redirect URIs (Web application client):
   - Web UI: `http://127.0.0.1:3001/oauth/google/callback`
   - CLI: `http://127.0.0.1:38475/oauth/google/callback` (default; override with `GOOGLE_OAUTH_LOOPBACK_PORT` or `liminal connect google --port N`)
   - Or create a **Desktop** OAuth client — Google allows dynamic loopback ports for CLI.
6. Add to `.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-secret
# Optional — stronger token encryption at rest:
# AGENT_OAUTH_ENCRYPTION_KEY=random-32-byte-secret
```

7. Install [uv](https://docs.astral.sh/uv/) for the Docs/Sheets sidecar (`uvx workspace-mcp`).

### 2. Liminal `.env`

```env
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
AGENT_GOOGLE_CONNECT_ON_BOOT=1
```

### 3. OAuth + attach (one command)

```bash
npm run build -w packages/core && npm run build -w packages/tools
liminal connect google --attach
```

This stores the refresh token, registers Drive/Gmail/Calendar/… MCP tools, and starts the Docs/Sheets sidecar when needed.

On later **web/tui** starts, `AGENT_GOOGLE_CONNECT_ON_BOOT=1` re-attaches MCP connections and restarts the sidecar automatically.

### Web UI (two clicks instead of CLI)

**Settings → Integrations**:

1. **Connect Google (OAuth)** — approve **all** requested permissions (Gmail, Drive, …).
2. **Attach MCP tools** — required; OAuth alone does not register tools.

## Connect

### CLI

```bash
liminal connect google --attach
liminal connect google --services drive,gmail --read-only --attach
liminal disconnect google
```

### Agent

```
list_connectors
connect_provider({ provider: "google_workspace", services: ["drive", "sheets"], mode: "read_write" })
```

## Gmail (hybrid: MCP + REST send)

Google's official Gmail MCP (`gmailmcp.googleapis.com`) covers **search, read, drafts, and labels** — it does **not** expose immediate send. Liminal uses a **hybrid**:

| Task | Tool |
|------|------|
| Search, read threads, list labels | `mcp_google_gmail_*` (official MCP) |
| **Draft for review (styled HTML)** | `gmail_create_draft` (REST — `body_html`, images, attachments) |
| **Send now** (user said send / deliver) | `gmail_send_message` (classic `users.messages.send`) |

Google's MCP `create_draft` is **plain text only**. The harness rejects substantive plain-only new mail there and routes styled drafts through `gmail_create_draft` instead.

After `liminal connect google --attach` with `gmail` in services, MCP tools register automatically. **`gmail_send_message`** is always registered when `AGENT_GOOGLE_GMAIL_SEND=1` (default) and uses the **same OAuth token** (`gmail.compose` scope).

Requires:

- **Gmail API** + **Gmail MCP API** enabled in Cloud Console
- [Workspace Developer Preview](https://developers.google.com/workspace/preview) enrollment for MCP
- OAuth scopes `gmail.readonly` and `gmail.compose` (re-connect if `list_connectors` shows `gmail_mcp=no`)

**Rich email.** `gmail_create_draft` and `gmail_send_message` support plain `body`, `body_html`, `inline_images`, and `attachments`. New outbound mail without a thread id must include FORMATTED `body_html` (the tools enforce R-EMAIL-STYLE). The harness **Email composition** protocol applies when Gmail MCP or REST compose tools are active.

Set `AGENT_GOOGLE_GMAIL_SEND=0` to disable REST send (draft-only via MCP).

## Architecture

| Service | Backend |
|---------|---------|
| Drive, Calendar, Chat, People | Official remote MCP |
| Gmail read / labels | Official Gmail MCP (`mcp_google_gmail_*`) |
| Gmail styled draft | Classic REST (`gmail_create_draft`) |
| Gmail immediate send | Classic REST (`gmail_send_message`) |
| Docs, Sheets, Slides, Forms, Tasks, … | Local `workspace-mcp` sidecar on port 8010 |

Connections persist under `~/.liminal/api_connections/`. OAuth tokens are encrypted under `~/.liminal/oauth/google/`.

## Environment keys

| Key | Default | Purpose |
|-----|---------|---------|
| `AGENT_GOOGLE_SIDECAR_ENABLE` | `1` | Enable productivity sidecar |
| `AGENT_GOOGLE_SIDECAR_CMD` | `uvx workspace-mcp` | Sidecar launch command |
| `AGENT_GOOGLE_SIDECAR_PORT` | `8010` | Local MCP port |
| `AGENT_GOOGLE_CONNECT_ON_BOOT` | `0` | Auto-restore connections on harness start |
| `AGENT_GOOGLE_GMAIL_SEND` | `1` | Register `gmail_create_draft` + `gmail_send_message` (REST); MCP has no HTML draft or send |

## Safety

- MCP **read** tools run without approval.
- MCP **write** tools require human approval (same as destructive shell/git tools).
- Use `mode: "read_only"` on `connect_provider` to register read tools only.

## Troubleshooting

- **Gmail MCP: "caller does not have permission"**: Enroll the project in [Workspace Developer Preview](https://developers.google.com/workspace/preview) and enable **Gmail MCP API** (`gmailmcp.googleapis.com`). Revoke the app at [Google Account permissions](https://myaccount.google.com/permissions), then `liminal connect google --attach`. `list_connectors` should show `gmail_mcp=yes`.
- **Gmail MCP tools return HTTP 403 "API disabled"**: Enable **Gmail MCP API** (`gmailmcp.googleapis.com`), not only Gmail API. Wait 1–2 minutes, then retry.
- **Gmail tools / missing scopes**: Confirm `list_connectors` shows `gmail_mcp=yes`; if not, revoke at [Google Account permissions](https://myaccount.google.com/permissions) and run `liminal connect google --attach` again.
- **OAuth error / no refresh token**: Revoke app access in [Google Account permissions](https://myaccount.google.com/permissions) and reconnect with `prompt=consent`.
- **Sidecar not ready** (Docs/Sheets): Run `uvx workspace-mcp --help` manually; ensure port 8010 is free.
- **Tools invisible under lazy loading**: Call `list_connectors` or `activate_tool_family("connectors")`; restored Google connections auto-activate by default.

Probe both APIs: `node scripts/lib/google-mcp-probe.mjs` (after `npm run build -w @liminal/core`).
