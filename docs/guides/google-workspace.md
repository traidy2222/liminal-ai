# Google Workspace integration

Liminal connects to Google Workspace through a **hybrid MCP architecture**:

- **Official Google MCP** (preview): Drive, Gmail, Calendar, Chat, People
- **Community sidecar** (`workspace-mcp` via `uvx`): Docs, Sheets, Slides, Forms, Tasks, Contacts, Apps Script, Custom Search

## Connect (recommended)

Liminal connects to Google Workspace through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — end users do **not** need their own Google Cloud OAuth client or secrets in `.env`.

1. Run Liminal (web UI, desktop, or CLI).
2. **Settings → Integrations → Google Workspace → Connect** (pick services and read/write mode).
3. Complete Google consent in the browser tab opened via Vireon.
4. Close the tab when you see **Connected** — tokens persist under `~/.liminal/oauth/google/`.
5. Click **Attach MCP tools** (or `liminal connect google --attach`) to enable agent tools.

CLI: `liminal connect google --attach` uses the same hosted flow.

### Operator setup (Vireon — one time)

In [Google Cloud Console](https://console.cloud.google.com/) for the **Vireon** OAuth project:

1. **APIs & Services → Library** — enable **both** the classic API and the **MCP** API for each official service:

   | You want | Classic API (REST) | **Also enable (MCP tools)** |
   |----------|-------------------|------------------------------|
   | Gmail | Gmail API | **Gmail MCP API** (`gmailmcp.googleapis.com`) |
   | Drive | Google Drive API | **Drive MCP API** (`drivemcp.googleapis.com`) |
   | Calendar | Google Calendar API | **Calendar MCP API** (`calendarmcp.googleapis.com`) |
   | Chat | Google Chat API | **Chat MCP API** (`chatmcp.googleapis.com`) |
   | People | People API | **People API** (`people.googleapis.com`) — MCP at `people.googleapis.com/mcp/v1` |

   Gmail uses **`mcp_google_gmail_*`** tools against `gmailmcp.googleapis.com`. Enable **Gmail MCP API** in addition to Gmail API.

   Sidecar (Docs/Sheets/…): Google Docs API, Sheets API, Slides API, Forms API, Tasks API, People API, Apps Script API.

   Analytics + Search Console (REST-only — no MCP):

   | You want | Enable in Cloud Console | OAuth scopes |
   |----------|-------------------------|--------------|
   | Google Analytics (GA4) | **Google Analytics Admin API** + **Google Analytics Data API** | `analytics.readonly`, `analytics.edit` |
   | Search Console | **Google Search Console API** (`searchconsole.googleapis.com`) | `webmasters.readonly`, `webmasters` |

   Check **Analytics (GA4)** and **Search Console** in Integrations when connecting (or pass `services: ["analytics","search_console"]`).

   OAuth scopes (read+write) now include **full Drive** (`drive`), **Calendar event write** (`calendar.events`), **Contacts write** (`contacts`), and **drive.readonly** on Docs/Sheets/Slides/Forms so the agent can open existing files — not only files the app created.
2. **OAuth consent screen** — add test users if app is in *Testing* mode. Under **Data access**, add Gmail scopes for connect + inbox automation: **`gmail.modify`** (read, compose, and label mail). For Gmail **MCP** preview tools you may also need `gmail.readonly` + `gmail.compose` on the consent screen ([Google doc](https://developers.google.com/workspace/gmail/api/guides/configure-mcp-server)).
3. **Workspace Developer Preview (required for MCP)** — Gmail/Drive/Calendar **MCP** APIs are preview-only. Enroll your Cloud project at [Google Workspace Developer Preview Program](https://developers.google.com/workspace/preview) (Workspace account + Cloud project). Until Google confirms enrollment, `tools/call` on `gmailmcp.googleapis.com` often returns *The caller does not have permission* even when classic Gmail API returns 200 and OAuth includes `gmail.compose`.
4. **Credentials → OAuth 2.0 Client** — **Web application**.
5. **Authorized redirect URI:** `https://www.vireondynamics.com/connect/google/callback` (YouTube uses the same URI — no second redirect needed).
6. **YouTube (separate integration)** — enable **YouTube Data API v3** and add `youtube.readonly` / `youtube.upload` on the consent screen. See [YouTube channel integration](youtube.md).
7. Add to **Vercel** env for `vireondynamics-website`:

```env
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
INTEGRATION_OAUTH_STATE_SECRET=...   # optional HMAC for OAuth state
```

8. Install [uv](https://docs.astral.sh/uv/) on machines using the Docs/Sheets sidecar (`uvx workspace-mcp`).

### Self-hosted / advanced (optional)

Power users can still use a **local** OAuth client with loopback redirect (`runGoogleConnectFlow`):

- Redirect: `http://127.0.0.1:38475/oauth/google/callback` or `http://127.0.0.1:3001/oauth/google/callback`
- Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the repo `.env`

### Liminal `.env` (typical user)

```env
AGENT_GOOGLE_CONNECT_ON_BOOT=1
# Optional — stronger token encryption at rest:
# AGENT_OAUTH_ENCRYPTION_KEY=random-32-byte-secret
```

`AGENT_GOOGLE_CONNECT_ON_BOOT` defaults to **1** — MCP tools and the Docs/Sheets sidecar restore automatically when OAuth tokens exist.

### OAuth + attach (one command)

```bash
liminal connect google --attach
```

Opens `vireondynamics.com/connect/google`, stores the refresh token, registers Drive/Gmail/Calendar/… MCP tools, and starts the Docs/Sheets sidecar when needed.

## Architecture

```text
Liminal (local) → opens vireondynamics.com/connect/google?redirect_uri=…&state=…
                → Google consent
                → site /connect/google/callback (token exchange)
                → form POST tokens to localhost …/api/integrations/oauth/handoff
                → ~/.liminal/oauth/google/
```

On later **web/tui** starts, `AGENT_GOOGLE_CONNECT_ON_BOOT=1` re-attaches MCP connections and restarts the sidecar automatically.

### Web / Desktop UI

**Settings → Integrations** (or Hub → Manage):

1. Leave **Read + write** selected and keep **all services** checked (default).
2. **Connect Google (OAuth + attach)** — approves scopes and registers MCP tools in one step.
3. Use **Attach MCP tools** separately only if you changed service checkboxes after OAuth.

**Re-connect after scope updates:** revoke Liminal at [Google Account permissions](https://myaccount.google.com/permissions), then connect again so new scopes (Calendar write, full Drive, Contacts write, …) are granted.

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
| **Send an existing draft** | `gmail_send_draft` (`draft_id` from create — no body rewrite) |
| **Send now** (one step, no prior draft) | `gmail_send_message` (classic `users.messages.send`) |

Google's MCP `create_draft` is **plain text only**. The harness rejects substantive plain-only new mail there and routes styled drafts through `gmail_create_draft` instead.

After `liminal connect google --attach` with `gmail` in services, MCP tools register automatically. **`gmail_send_message`** is always registered when `AGENT_GOOGLE_GMAIL_SEND=1` (default) and uses the **same OAuth token** (`gmail.compose` scope).

Requires:

- **Gmail API** + **Gmail MCP API** enabled in Cloud Console
- [Workspace Developer Preview](https://developers.google.com/workspace/preview) enrollment for MCP
- OAuth scopes `gmail.readonly` and `gmail.compose` (re-connect if `list_connectors` shows `gmail_mcp=no`)

**Rich email.** `gmail_create_draft` and `gmail_send_message` support plain `body`, `body_html`, `inline_images`, and `attachments`. New outbound mail without a thread id must include FORMATTED `body_html` (the tools enforce R-EMAIL-STYLE). The harness **Email composition** protocol applies when Gmail MCP or REST compose tools are active.

Set `AGENT_GOOGLE_GMAIL_SEND=0` to disable REST send (draft-only via MCP).

## Calendar (hybrid: MCP + REST)

Official Calendar MCP (`calendarmcp.googleapis.com`) covers **list/get/create/update/delete events**, **respond to invites**, and **suggest_time**. Liminal adds classic REST tools when `AGENT_GOOGLE_CALENDAR_REST=1` (default):

| Task | Tool |
|------|------|
| List/get events, MCP create/update/delete, suggest_time | `mcp_google_calendar_*` |
| **Get calendar** metadata (incl. primary `timeZone`) | `calendar_rest_get_calendar` |
| **List calendars** in account | `calendar_rest_list_calendars` |
| **Account settings** (timezone read-only via API) | `calendar_rest_list_settings`, `calendar_rest_get_setting` |
| **Change calendar timezone** (primary or secondary) | `calendar_rest_set_timezone` |
| **UI colors** for calendars/events | `calendar_rest_list_colors` |
| **Hide/show, colors, default reminders** on calendar list | `calendar_rest_patch_calendar_list` |
| **Subscribe** to a shared calendar / **hide** from list | `calendar_rest_subscribe_calendar`, `calendar_rest_unsubscribe_calendar` |
| **Clear all events** from a calendar | `calendar_rest_clear_calendar` |
| **List/get events** (REST, full query params) | `calendar_rest_list_events`, `calendar_rest_get_event` |
| **Batch free/busy** across calendars | `calendar_rest_freebusy` |
| **Natural language** event ("lunch Tuesday noon") | `calendar_rest_quick_add` |
| **Full Event JSON** + **Google Meet** + recurrence | `calendar_rest_insert_event` / `calendar_rest_patch_event` / `calendar_rest_replace_event` |
| **Recurring instances** in a window | `calendar_rest_list_instances` |
| **RSVP** accept/decline/tentative | `calendar_rest_respond_to_event` |
| **Cancel with guest email control** | `calendar_rest_delete_event` (`send_updates`) |
| **Move** event to another calendar | `calendar_rest_move_event` |
| **Import iCal** event | `calendar_rest_import_event` |
| **Calendar** create/update/delete | `calendar_rest_manage_calendar` |
| **Sharing / ACL** | `calendar_rest_list_acl`, `calendar_rest_set_acl` |

Requires **Google Calendar API** enabled (classic `calendar-json.googleapis.com`) plus Calendar MCP API for MCP tools. OAuth needs `calendar.events` and full `calendar` scope for ACL/calendar CRUD — re-connect OAuth after scope updates.

Set `AGENT_GOOGLE_CALENDAR_REST=0` to disable REST calendar tools (MCP-only).

## Docs / Sheets / Slides (hybrid: sidecar MCP + REST)

Docs, Sheets, and Slides use the local **`workspace-mcp`** sidecar (`mcp_google_ext_*`). Liminal adds classic REST when `AGENT_GOOGLE_OFFICE_REST=1` (default):

| Task | Tool |
|------|------|
| High-level read/edit via sidecar | `mcp_google_ext_*` (after `connect_provider` with docs/sheets/slides) |
| **Read Doc** (outline + tables as text) | `docs_rest_extract_text` |
| **Get full Doc JSON** (indices, structure) | `docs_rest_get_document` |
| **Create blank Doc** | `docs_rest_create_document` |
| **Copy template Doc** | `docs_rest_copy_document` |
| **Write rich content** (headings, lists, tables, links, images) | `docs_rest_write_blocks` |
| **Insert image** (upload + inline) | `docs_rest_insert_image` |
| **Find/replace placeholders** | `docs_rest_replace_all_text` |
| **Format index range** (bold, colors, alignment, headings) | `docs_rest_format_range` |
| **Delete content range** | `docs_rest_delete_content` |
| **Advanced API** (headers, merge cells, …) | `docs_rest_batch_update` |
| **Spreadsheet metadata** | `sheets_rest_get_spreadsheet` |
| **Create spreadsheet** | `sheets_rest_create_spreadsheet` |
| **Read/write cell values** | `sheets_rest_get_values`, `sheets_rest_update_values`, `sheets_rest_append_values` |
| **Multiple ranges** | `sheets_rest_batch_get_values`, `sheets_rest_batch_update_values` |
| **Clear range / format / add sheets** | `sheets_rest_clear_values`, `sheets_rest_batch_update` |
| **Get Slides deck** | `slides_rest_get_presentation` |
| **Create deck / edit slides** | `slides_rest_create_presentation`, `slides_rest_batch_update` |
| **Single slide / thumbnail** | `slides_rest_get_page`, `slides_rest_get_thumbnail` |
| **Export PDF, CSV, plain text, Office formats** | `office_rest_export_file` (Drive export) |

Requires **Google Docs API**, **Sheets API**, **Slides API**, and **Drive API** enabled. OAuth scopes `documents`, `spreadsheets`, and `presentations` (write) plus `drive.readonly` for opening existing files — re-connect OAuth after scope updates.

Set `AGENT_GOOGLE_OFFICE_REST=0` to disable REST office tools (sidecar MCP only).

## Google Analytics (GA4) — REST

No official Google MCP for GA4. Liminal registers `analytics_rest_*` when `AGENT_GOOGLE_ANALYTICS_REST=1` (default) and OAuth includes the **analytics** service.

| Task | Tool |
|------|------|
| Discover accounts / properties | `analytics_rest_list_account_summaries`, `analytics_rest_list_properties` |
| Property metadata / edit | `analytics_rest_get_property`, `analytics_rest_update_property` |
| Data streams | `analytics_rest_list_data_streams` |
| Custom dimensions | `analytics_rest_list_custom_dimensions`, `analytics_rest_create_custom_dimension` |
| Available dimensions/metrics | `analytics_rest_get_metadata` |
| Standard reports | `analytics_rest_run_report`, `analytics_rest_batch_run_reports` |
| Realtime | `analytics_rest_run_realtime_report` |

Workflow: `list_account_summaries` → pick `property_id` (e.g. `properties/123456789`) → `run_report` with `start_date`, `end_date`, `metrics`, optional `dimensions`.

Requires **Analytics Admin API** and **Analytics Data API** enabled. Re-connect OAuth after adding the analytics service.

Set `AGENT_GOOGLE_ANALYTICS_REST=0` to disable.

## Search Console — REST

REST-only (`search_console_rest_*`) when `AGENT_GOOGLE_SEARCH_CONSOLE_REST=1` (default) and OAuth includes **search_console**.

| Task | Tool |
|------|------|
| List properties | `search_console_rest_list_sites` |
| Performance (queries, pages, CTR, position) | `search_console_rest_query_search_analytics` |
| URL index status | `search_console_rest_inspect_url` |
| Sitemaps | `search_console_rest_list_sitemaps`, `search_console_rest_get_sitemap`, `search_console_rest_submit_sitemap`, `search_console_rest_delete_sitemap` |

`site_url` must match Search Console exactly (`sc-domain:example.com` or `https://www.example.com/`).

Requires **Search Console API** enabled. Set `AGENT_GOOGLE_SEARCH_CONSOLE_REST=0` to disable.

## Architecture

| Service | Backend |
|---------|---------|
| Drive, Calendar, Chat, People | Official remote MCP |
| Gmail read / labels | Official Gmail MCP (`mcp_google_gmail_*`) |
| Gmail styled draft | Classic REST (`gmail_create_draft`) |
| Gmail immediate send | Classic REST (`gmail_send_message`) |
| Calendar timezone/settings/colors/events/freebusy/ACL/Meet | Classic REST (`calendar_rest_*`) |
| Docs/Sheets/Slides read-edit (sidecar) | Local `workspace-mcp` → `mcp_google_ext_*` |
| Docs/Sheets/Slides batch API + export | Classic REST (`docs_rest_*`, `sheets_rest_*`, `slides_rest_*`, `office_rest_export_file`) |
| Google Analytics (GA4) | Classic REST (`analytics_rest_*`) — Admin + Data APIs |
| Search Console | Classic REST (`search_console_rest_*`) |
| Forms, Tasks, … | Local `workspace-mcp` sidecar on port 8010 |

Connections persist under `~/.liminal/api_connections/`. OAuth tokens are encrypted under `~/.liminal/oauth/google/`.

## Environment keys

| Key | Default | Purpose |
|-----|---------|---------|
| `AGENT_GOOGLE_SIDECAR_ENABLE` | `1` | Enable productivity sidecar |
| `AGENT_GOOGLE_SIDECAR_CMD` | `uvx workspace-mcp` | Sidecar launch command |
| `AGENT_GOOGLE_SIDECAR_PORT` | `8010` | Local MCP port |
| `AGENT_GOOGLE_CONNECT_ON_BOOT` | `1` | Auto-restore connections on harness start |
| `AGENT_GOOGLE_GMAIL_SEND` | `1` | Register `gmail_create_draft` + `gmail_send_message` (REST); MCP has no HTML draft or send |
| `AGENT_GOOGLE_CALENDAR_REST` | `1` | Register full `calendar_rest_*` surface (calendars, timezone, events, freebusy, ACL, Meet, …) alongside Calendar MCP |
| `AGENT_GOOGLE_OFFICE_REST` | `1` | Register `docs_rest_*`, `sheets_rest_*`, `slides_rest_*`, `office_rest_export_file` alongside workspace-mcp |
| `AGENT_GOOGLE_ANALYTICS_REST` | `1` | Register `analytics_rest_*` (GA4 Admin + Data APIs) |
| `AGENT_GOOGLE_SEARCH_CONSOLE_REST` | `1` | Register `search_console_rest_*` (sites, analytics, inspection, sitemaps) |

## Google MCP agent tips (arg aliases)

Official Google MCP tools are registered dynamically (`mcp_google_{service}_{remote_name}`). The harness normalizes common model mistakes before validation:

| You can pass | Maps to |
|--------------|---------|
| `page_size`, `limit`, `max_results` | `pageSize` (integer) |
| `page_token`, `next_page_token` | `pageToken` |
| `q`, `search`, `term` | `query` |
| `calendar_id` | `calendarId` |
| `space_name` | `spaceName` |

**Drive search queries:** Use ISO8601 UTC dates in quotes: `modifiedTime > "2024-06-05T00:00:00Z"`. Bare `2024-06-05` is auto-fixed by the harness but prefer full ISO strings.

**Sheets REST:** `sheets_rest_update_values` needs `values` as a 2D JSON array `[["col1","col2"]]`. JSON strings and single rows are coerced automatically.

**Calendar REST:** `time_min` / `time_max` accept `2024-06-05` and expand to `2024-06-05T00:00:00Z`.

**Integer fields:** Google MCP schemas declare `integer`; JSON only has numbers — the harness coerces `pageSize: 25` and `"25"` correctly (fixes `expected integer, got number`). Default `pageSize` is 25 when omitted on list tools.

**People MCP 403:** Enable People API, re-connect OAuth (adds `userinfo.profile`), enroll in Workspace Developer Preview. `directory.readonly` needs Workspace admin for org directory — personal `get_user_profile` uses contacts/profile scopes.

Re-attach after harness update: `connect_provider({ provider: "google_workspace" })` or Integrations → Attach MCP tools.

## Safety

- MCP **read** tools run without approval.
- MCP **write** tools require human approval (same as destructive shell/git tools).
- Use `mode: "read_only"` on `connect_provider` to register read tools only.

## Troubleshooting

- **Gmail MCP: "caller does not have permission"**: Enroll the project in [Workspace Developer Preview](https://developers.google.com/workspace/preview) and enable **Gmail MCP API** (`gmailmcp.googleapis.com`). Revoke the app at [Google Account permissions](https://myaccount.google.com/permissions), then `liminal connect google --attach`. `list_connectors` should show `gmail_mcp=yes`.
- **Gmail MCP tools return HTTP 403 "API disabled"**: Enable **Gmail MCP API** (`gmailmcp.googleapis.com`), not only Gmail API. Wait 1–2 minutes, then retry.
- **Gmail tools / missing scopes**: Confirm `list_connectors` shows `gmail_mcp=yes`; if not, revoke at [Google Account permissions](https://myaccount.google.com/permissions) and run `liminal connect google --attach` again.
- **OAuth error / no refresh token**: Revoke app access in [Google Account permissions](https://myaccount.google.com/permissions) and reconnect with `prompt=consent`.
- **Sidecar not ready** (Docs/Sheets): Install [uv](https://docs.astral.sh/uv/), ensure `GOOGLE_OAUTH_CLIENT_ID` is in `.env`, and port `8010` is free (`AGENT_GOOGLE_SIDECAR_PORT`). Liminal sets `WORKSPACE_MCP_PORT` — do **not** pass `--port` to workspace-mcp (unsupported). Test: `set WORKSPACE_MCP_PORT=8010 && uvx workspace-mcp --transport streamable-http --tools docs sheets slides`.
- **Gmail works, Calendar does not**: Calendar uses a **separate** MCP connection (`google_calendar`) and **calendarmcp.googleapis.com** (not the same as Gmail MCP). Desktop: **Integrations → Attach Calendar**. Agent: `connect_provider({ provider: "google_workspace", services: ["calendar"] })`. `list_connectors` **Live probes** section shows attach + API status for each.
- **Calendar MCP 403 vs Calendar REST works**: Official MCP (`calendarmcp.googleapis.com`) and classic REST (`calendar.googleapis.com`) are different Cloud APIs — enable both if you use hybrid tools.
- **Tools invisible under lazy loading**: Call `list_connectors` or `activate_tool_family({ family: "google_workspace" })`; restored Google connections auto-activate by default when `AGENT_INTEGRATION_AUTO_ACTIVATE=1`.
- **`Invalid args: pageSize expected integer, got number`**: Update harness (fixed in core dispatcher) and restart; aliases `page_size` / `limit` also work.
- **People MCP 403 on `get_user_profile`**: Enable People API, re-OAuth with People service checked, confirm Workspace Developer Preview enrollment.

Probe both APIs: `node scripts/lib/google-mcp-probe.mjs` (after `npm run build -w @liminal/core`).
