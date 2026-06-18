# YouTube channel integration

Liminal connects to **YouTube** as a **separate integration** from Google Workspace — same Google account can link Gmail via Workspace and a channel via YouTube without mixing OAuth scopes.

Hosted OAuth runs on [vireondynamics.com](https://www.vireondynamics.com). Tokens live under `~/.liminal/oauth/youtube/`.

## Connect

1. Run Liminal web UI or desktop.
2. **Settings → Integrations → YouTube → Connect**.
3. Pick **Read + write** (upload/update metadata) or **Read only**.
4. Optionally enable **Include revenue analytics** (YouTube Partner Program — estimated revenue, ad performance).
5. Complete Google consent (`prompt=consent select_account` — pick the Google account that owns the channel).
6. Close the tab when you see **Connected**.

Or: `connect_provider({ provider: "youtube", start_oauth: true })` or desktop `/connect youtube`.

After scope changes ship, **reconnect** so existing tokens pick up analytics scopes.

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `youtube_rest_get_channel` | Channel id, title, custom URL, lifetime subscriber/view counts |
| `youtube_rest_get_video` | One video — lifetime **views** vs **likes** clearly labeled |
| `youtube_rest_list_videos` | List uploads with separated lifetime stats |
| `youtube_rest_update_video` | Update snippet (title, description, tags, privacy) |
| `youtube_rest_upload_video` | Stub in v1 — use resumable upload externally |
| `youtube_analytics_report` | **Preferred** — preset Studio reports (daily, top videos, traffic, engagement) |
| `youtube_analytics_query` | Low-level Analytics API (advanced custom queries) |

### Views vs likes (common mistake)

| Source | `views` | `likes` |
| ------ | ------- | ------- |
| Data API (`youtube_rest_get_video`) | Lifetime public `viewCount` | Lifetime public `likeCount` |
| Analytics (`youtube_analytics_report`) | Watch count **in the date range** | Like actions **in the date range** |

Use `youtube_analytics_report` for “how did we do last month?” Use `youtube_rest_get_video` for “how many views does this video have total?”

Example analytics report:

```json
{
  "start_date": "2026-01-01",
  "end_date": "2026-01-31",
  "report_type": "channel_daily"
}
```

Example low-level query:

```json
{
  "start_date": "2026-01-01",
  "end_date": "2026-01-31",
  "metrics": "views,estimatedMinutesWatched,subscribersGained",
  "dimensions": "day"
}
```

With lazy loading: `activate_tool_family({ family: "youtube" })`.

Disable with `AGENT_YOUTUBE_REST=0`.

## Operator setup (Vireon — one time)

Uses the **same** Google Cloud OAuth client as Google Workspace (`GOOGLE_OAUTH_CLIENT_*` on Vercel).

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Library** → enable:
   - **YouTube Data API v3**
   - **YouTube Analytics API**
2. **OAuth consent screen → Data access** — add scopes:
   - `https://www.googleapis.com/auth/youtube.readonly` (read-only mode)
   - `https://www.googleapis.com/auth/youtube` (read + write — required for video metadata updates; `youtube.upload` alone is insufficient)
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
   - `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` (optional — revenue tier)
3. **Credentials → OAuth 2.0 Client (Web application)** — YouTube reuses the Workspace redirect URI (already registered):

   ```
   https://www.vireondynamics.com/connect/google/callback
   ```

   No separate `/connect/youtube/callback` entry is required.

4. Vercel env on `vireondynamics-website` (already required for Google Workspace):

```env
GOOGLE_OAUTH_CLIENT_ID=....apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
```

Token refresh for the `youtube` provider reuses the Google token endpoint via `POST /api/integrations/oauth/refresh` with `provider: "youtube"`.

## Flow

```
Liminal (local) → opens vireondynamics.com/connect/youtube?redirect_uri=…&state=…&monetary=1
                → Google OAuth (YouTube + Analytics scopes)
                → site /connect/google/callback (token exchange + channels.list mine=true)
                → POST tokens to local harness handoff
                → youtube_rest_* + youtube_analytics_query tools active
```
