# Microsoft 365 integration

Liminal connects to Microsoft 365 through a **hybrid architecture**:

- **Community sidecar** (`@softeria/ms-365-mcp-server --http`): 200+ Microsoft Graph tools (`mcp_microsoft_*`)
- **Curated REST tools**: polished Outlook HTML mail, calendar with Teams meetings, OneDrive upload/share, Excel ranges, search

## Connect once (recommended)

### 1. Azure Portal (one time)

1. [Azure Portal](https://portal.azure.com) → **Microsoft Entra ID** → **App registrations** → **New registration**
2. **Redirect URIs** (Web) — use `localhost` (Azure often rejects `127.0.0.1`):
   - Web UI: `http://localhost:3001/oauth/microsoft/callback`
   - CLI/desktop loopback: `http://localhost:38476/oauth/microsoft/callback`
3. **API permissions** → Microsoft Graph → **Delegated** permissions for services you need:
   - Mail: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - Calendar: `Calendars.ReadWrite`, `OnlineMeetings.ReadWrite`
   - Files: `Files.ReadWrite.All`
   - Teams: `Chat.ReadWrite`, `ChannelMessage.Send`, `ChannelMessage.Read.All`, `Team.ReadBasic.All`
   - Planner/To Do: `Tasks.ReadWrite`, `Group.Read.All`
   - OneNote: `Notes.ReadWrite.All`
   - SharePoint: `Sites.ReadWrite.All`
4. Grant admin consent if your tenant requires it.
5. Add to `.env`:

```env
MICROSOFT_OAUTH_CLIENT_ID=your-application-client-id
MICROSOFT_OAUTH_CLIENT_SECRET=your-secret   # optional for public/native apps
MICROSOFT_TENANT_ID=common                  # or your org tenant id
AGENT_MICROSOFT_SIDECAR_ENABLE=1
AGENT_MICROSOFT_SIDECAR_PORT=8011
# AGENT_MICROSOFT_CONNECT_ON_BOOT=1   # optional — auto-attach MCP on startup (off by default; saves tokens when lazy)
# AGENT_INTEGRATION_AUTO_ACTIVATE=1   # optional — expose all MCP tools immediately (off when AGENT_TOOL_LAZY=1)
```

With **`AGENT_TOOL_LAZY=1`** (default), Microsoft tools register when you Connect but stay **off the model API** until the agent calls `activate_tool_family({ family: "connectors" })` or the user message mentions mail/calendar/Teams (intent pre-seed). Simple coding questions therefore do not pay for 200+ `mcp_microsoft_*` schemas.

### 2. Connect in UI

**Settings → Integrations → Microsoft 365 → Connect**

One tap runs OAuth (if needed) and attaches MCP tools.

### 3. Agent tools

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

- **Sidecar won't start:** ensure Node.js/npx available; port 8011 free; `MICROSOFT_OAUTH_CLIENT_ID` set
- **403 from Graph:** reconnect with expanded service checkboxes; verify Azure API permissions + admin consent
- **Missing refresh token:** ensure `offline_access` scope; revoke app at [mysignins.microsoft.com](https://mysignins.microsoft.com/) and reconnect
