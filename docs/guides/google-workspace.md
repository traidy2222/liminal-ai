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

   Enabling only “Gmail API” fixes direct REST calls but **not** `mcp_google_gmail_*` tools — those hit `gmailmcp.googleapis.com` and return 403 until **Gmail MCP API** is on.

   Sidecar (Docs/Sheets/…): Google Docs API, Sheets API, Slides API, Forms API, Tasks API, People API.
2. **OAuth consent screen** — add test users if app is in *Testing* mode. Under **Data access**, manually add Google's **MCP** scopes (not only the classic REST scopes). Minimum for Gmail MCP: `gmail.readonly` + `gmail.compose` ([Google doc](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)).
3. **Workspace Developer Preview (required for MCP)** — Gmail/Drive/Calendar **MCP** APIs are preview-only. Enroll project `102482009638` at [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview) (Workspace account + Cloud project). Until Google confirms enrollment, `tools/call` on `gmailmcp.googleapis.com` often returns *The caller does not have permission* even when classic Gmail API returns 200 and OAuth includes `gmail.compose`.
3. **Credentials → OAuth 2.0 Client** (Web or Desktop).
3. Add authorized redirect URIs (Web application client):
   - Web UI: `http://127.0.0.1:3001/oauth/google/callback`
   - CLI: `http://127.0.0.1:38475/oauth/google/callback` (default; override with `GOOGLE_OAUTH_LOOPBACK_PORT` or `liminal connect google --port N`)
   - Or create a **Desktop** OAuth client — Google allows dynamic loopback ports for CLI.
4. Add to `.env`:

```env
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-secret
# Optional — stronger token encryption at rest:
# AGENT_OAUTH_ENCRYPTION_KEY=random-32-byte-secret
```

5. Install [uv](https://docs.astral.sh/uv/) for the Docs/Sheets sidecar (`uvx workspace-mcp`).

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

## Gmail without MCP preview (REST bridge)

While **Gmail MCP** (`gmailmcp.googleapis.com`) waits on [Workspace Developer Preview](https://developers.google.com/workspace/preview), Liminal exposes **classic Gmail API** tools (same OAuth token, `gmail.googleapis.com`):

| Tool | Purpose |
|------|---------|
| `gmail_api_list_labels` | List labels |
| `gmail_api_search_threads` | Search (`from:`, `is:unread`, etc.) |
| `gmail_api_get_thread` | Thread + message IDs |
| `gmail_api_get_message` | Full message body |
| `gmail_api_create_draft` | Create draft (approval-gated; needs `gmail.compose`) |

Requires **Gmail API** enabled in Cloud Console and a completed `liminal connect google`. Set `AGENT_GOOGLE_GMAIL_REST=0` to disable.

**Choosing REST vs MCP — `AGENT_GOOGLE_GMAIL_TRANSPORT`** (Settings → Harness → *Gmail Transport*). The Gmail MCP endpoint (`gmailmcp.googleapis.com`) is an invite-only preview; for most projects it returns `403 "The caller does not have permission"`. So the default is **`rest`**, which uses the classic `gmail_api_*` tools and does **not** attach the preview MCP (so the model never reaches for the broken `mcp_google_gmail_*` tools). Only switch to `mcp` (preview only) or `auto` (preview MCP + REST fallback) once you are enrolled in the Workspace MCP preview **and** have enabled `gmailmcp.googleapis.com`. In `rest` mode the same `gmail.readonly` / `gmail.compose` OAuth scopes are still requested, so REST works with your existing token.

## Architecture

| Service | Backend |
|---------|---------|
| Drive, Gmail, Calendar, Chat, People | Official remote MCP |
| Gmail (fallback) | Classic REST (`gmail_api_*`) when MCP preview blocked |
| Docs, Sheets, Slides, Forms, Tasks, … | Local `workspace-mcp` sidecar on port 8010 |

Connections persist under `~/.liminal/api_connections/`. OAuth tokens are encrypted under `~/.liminal/oauth/google/`.

## Environment keys

| Key | Default | Purpose |
|-----|---------|---------|
| `AGENT_GOOGLE_SIDECAR_ENABLE` | `1` | Enable productivity sidecar |
| `AGENT_GOOGLE_SIDECAR_CMD` | `uvx workspace-mcp` | Sidecar launch command |
| `AGENT_GOOGLE_SIDECAR_PORT` | `8010` | Local MCP port |
| `AGENT_GOOGLE_CONNECT_ON_BOOT` | `0` | Auto-restore connections on harness start |
| `AGENT_GOOGLE_GMAIL_REST` | `1` | Register `gmail_api_*` classic REST tools (works without MCP preview) |
| `AGENT_GOOGLE_GMAIL_TRANSPORT` | `rest` | `rest` = classic REST only (no preview needed); `mcp` = preview `mcp_google_gmail_*` only; `auto` = preview MCP + REST fallback |

## Safety

- MCP **read** tools run without approval.
- MCP **write** tools require human approval (same as destructive shell/git tools).
- Use `mode: "read_only"` on `connect_provider` to register read tools only.

## Troubleshooting

- **Gmail MCP: "caller does not have permission" and you're NOT in the preview**: This is expected — `gmailmcp.googleapis.com` is invite-only. Set `AGENT_GOOGLE_GMAIL_TRANSPORT=rest` (Settings → Harness → Gmail Transport) and use the `gmail_api_*` tools, which work with a normal OAuth token. (This is the default; you only see the MCP error if it was set to `mcp`/`auto`.)
- **Gmail MCP: "caller does not have permission"** (preview-enrolled, API enabled): Your token likely lacks **`gmail.compose`** (Liminal used `gmail.modify` before — wrong for MCP). Revoke the app at [Google Account permissions](https://myaccount.google.com/permissions), then `liminal connect google --attach`. `list_connectors` should show `gmail_mcp=yes`.
- **Gmail MCP tools return HTTP 403 "API disabled"**: Enable **Gmail MCP API** (`gmailmcp.googleapis.com`), not only Gmail API. Wait 1–2 minutes, then retry.
- **Gmail tools / missing scopes**: Confirm `list_connectors` shows `gmail=yes`; if not, revoke at [Google Account permissions](https://myaccount.google.com/permissions) and run `liminal connect google --attach` again.
- **OAuth error / no refresh token**: Revoke app access in [Google Account permissions](https://myaccount.google.com/permissions) and reconnect with `prompt=consent`.
- **Sidecar not ready** (Docs/Sheets): Run `uvx workspace-mcp --help` manually; ensure port 8010 is free.
- **Tools invisible under lazy loading**: Call `list_connectors` or `activate_tool_family("connectors")`; restored Google connections auto-activate by default.
