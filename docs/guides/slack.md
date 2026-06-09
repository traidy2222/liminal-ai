# Slack integration

Liminal connects to **Slack** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never paste Slack tokens into `.env`.

This is a **harness integration only** (Settings → Integrations). It is not used for website account login.

## Connect

1. Run Liminal web UI or desktop.
2. **Settings → Integrations → Slack → Connect**.
3. Complete Slack consent in the browser tab.
4. Close the tab when you see **Connected** — tokens are stored under `~/.liminal/oauth/slack/`.

Or: `connect_provider({ provider: "slack" })` after OAuth is on disk.

### Read vs write

- **Read + write** (default): list channels, read history, post messages (`slack_post_message` is approval-gated).
- **Read only**: channels, history, users — no posting.

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `slack_list_channels` | Public/private channels |
| `slack_list_dms` | Open DM channels |
| `slack_list_users` | Workspace members |
| `slack_open_dm` | Open DM with a user (returns channel id) |
| `slack_get_channel_history` | Recent messages in a channel |
| `slack_get_thread_replies` | Replies in a thread |
| `slack_search_messages` | Search workspace messages |
| `slack_post_message` | Post to a channel (approval required) |
| `slack_reply_in_thread` | Reply in a thread (approval required) |
| `slack_add_reaction` | Add emoji reaction (approval required) |
| `slack_upload_file` | Upload a small text file (approval required) |

With lazy loading: `activate_tool_family({ family: "slack" })`.

Disable with `AGENT_SLACK_REST=0`.

## Operator setup (Vireon — one time)

1. [Slack API](https://api.slack.com/apps) → **Create New App** → From scratch.
2. **OAuth & Permissions** → add **Redirect URL**:

   ```
   https://www.vireondynamics.com/connect/slack/callback
   ```

3. **User Token Scopes** (not bot scopes) — harness requests these explicitly via `scopes=` on the connect URL:

   **Read:** `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, `search:read:user`

   **Write (read+write mode):** `chat:write`, `reactions:write`, `files:write:user`, `im:write:user`, `channels:write`, `groups:write`, `mpim:write`

4. Vercel env: `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`.

5. **Vireon `/connect/slack` handler** must pass the `scopes` query param through to Slack `oauth/v2/authorize` (comma-separated user scopes). `mode=read_write` alone is not enough — without `scopes=`, users get a minimal token and tools return `missing_scope`.
