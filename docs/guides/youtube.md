# YouTube channel integration

Liminal connects to **YouTube** as a **separate integration** from Google Workspace — same Google account can link Gmail via Workspace and a channel via YouTube without mixing OAuth scopes.

Hosted OAuth runs on [vireondynamics.com](https://www.vireondynamics.com). Tokens live under `~/.liminal/oauth/youtube/`.

## Connect

1. Run Liminal web UI or desktop.
2. **Settings → Integrations → YouTube → Connect**.
3. Pick **Read + write** (upload/update metadata) or **Read only**.
4. Complete Google consent (`prompt=consent select_account` — pick the Google account that owns the channel).
5. Close the tab when you see **Connected**.

Or: `connect_provider({ provider: "youtube", start_oauth: true })` or desktop `/connect youtube`.

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `youtube_rest_get_channel` | Channel id, title, custom URL for the connected account |
| `youtube_rest_list_videos` | List uploads on the channel |
| `youtube_rest_update_video` | Update snippet (title, description, tags, privacy) |
| `youtube_rest_upload_video` | Stub in v1 — use resumable upload externally |

With lazy loading: `activate_tool_family({ family: "youtube" })`.

Disable with `AGENT_YOUTUBE_REST=0`.

## Operator setup (Vireon — one time)

Uses the **same** Google Cloud OAuth client as Google Workspace (`GOOGLE_OAUTH_CLIENT_*` on Vercel).

1. [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → Library** → enable **YouTube Data API v3**.
2. **OAuth consent screen → Data access** — add scopes:
   - `https://www.googleapis.com/auth/youtube.readonly`
   - `https://www.googleapis.com/auth/youtube.upload`
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
Liminal (local) → opens vireondynamics.com/connect/youtube?redirect_uri=…&state=…
                → Google OAuth (YouTube scopes only)
                → site /connect/google/callback (token exchange + channels.list mine=true)
                → POST tokens to local harness handoff
                → youtube_rest_* tools active
```
