# Microsoft 365 integration

Liminal connects to Microsoft 365 through a **hybrid architecture**:

- **Community sidecar** (`@softeria/ms-365-mcp-server --http`): 200+ Microsoft Graph tools (`mcp_microsoft_*`)
- **Curated REST tools**: polished Outlook HTML mail, calendar with Teams meetings, OneDrive upload/share, Excel ranges, search

## Connect once (recommended)

### 1. Connect in UI

**Settings → Integrations → Microsoft 365 → Connect**

Opens `vireondynamics.com/connect/microsoft`, stores encrypted tokens under `~/.liminal/oauth/microsoft/`, and attaches MCP tools.

No `MICROSOFT_OAUTH_CLIENT_ID` in your local `.env` — OAuth runs on Vireon-hosted Entra app registration.

### 2. Optional local tuning

```env
AGENT_MICROSOFT_SIDECAR_ENABLE=1
AGENT_MICROSOFT_SIDECAR_PORT=8011
# AGENT_MICROSOFT_CONNECT_ON_BOOT=1   # optional — auto-attach MCP on startup
# AGENT_INTEGRATION_AUTO_ACTIVATE=1   # optional — expose all MCP tools immediately (off when AGENT_TOOL_LAZY=1)
```

With **`AGENT_TOOL_LAZY=1`** (default), Microsoft tools register when you Connect but stay **off the model API** until the agent calls `activate_tool_family({ family: "connectors" })` or the user message mentions mail/calendar/Teams (intent pre-seed).

### 3. Hosted OAuth flow

```
Liminal (local) → opens vireondynamics.com/connect/microsoft?redirect_uri=…&state=…
                → Microsoft Entra consent
                → site /connect/microsoft/callback (token exchange)
                → form POST → http://127.0.0.1:<port>/api/integrations/oauth/handoff
                → ~/.liminal/oauth/microsoft/
```

### 4. Agent tools

| User ask | Tool path |
|----------|-----------|
| Read/search mail | `mcp_microsoft_*` |
| Send HTML email | `outlook_send_message` |
| Calendar + Teams meeting | `outlook_calendar_rest_create_event` with `is_online_meeting: true` |
| OneDrive files | `mcp_microsoft_*` + `onedrive_rest_*` |
| Excel cells | `excel_rest_read_range` / `excel_rest_update_range` |
| Teams message | `teams_rest_post_channel_message` |
| Planner / To Do | `planner_rest_*`, `todo_rest_*` |
| Search M365 | `graph_search_rest_query` |

### Word / PowerPoint limits

Microsoft Graph does **not** support in-place Word body editing like Google Docs. The agent can:

- Upload/download `.docx` / `.pptx` via OneDrive
- Export PDF via `office_rest_export_pdf`
- Re-upload after local transforms

## Vireon site operator setup (one time)

For self-hosted Liminal builds that still use `vireondynamics.com`:

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → app used by Vireon
2. **Redirect URI** (Web): `https://www.vireondynamics.com/connect/microsoft/callback`
3. **API permissions** → Microsoft Graph → **Delegated** permissions for services you need (mail, calendar, files, Teams, …)
4. Grant admin consent if your tenant requires it
5. Vercel env: `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET`, optional `MICROSOFT_TENANT_ID=common`

## Manual test checklist

1. Connect Microsoft 365 in Integrations (all services checked)
2. Send test mail: `outlook_send_message` with `body_html`
3. Create calendar event with Teams link: `outlook_calendar_rest_create_event`
4. Upload file: `onedrive_rest_upload_file`
5. Create share link: `onedrive_rest_create_share_link`
6. Post Teams channel message (if Teams enabled)
7. Create Planner task: `planner_rest_create_task`
8. Unified search: `graph_search_rest_query`

## Troubleshooting

- **Sidecar won't start:** ensure Node.js/npx available; port 8011 free
- **403 from Graph:** reconnect with expanded service checkboxes; verify Azure API permissions + admin consent on the Vireon app
- **Missing refresh token:** revoke app at [mysignins.microsoft.com](https://mysignins.microsoft.com/) and reconnect
- **Legacy local OAuth:** older builds used `http://localhost:3001/oauth/microsoft/callback` with `MICROSOFT_OAUTH_CLIENT_ID` in `.env` — disconnect, upgrade, and use hosted Connect
