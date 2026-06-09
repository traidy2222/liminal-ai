# Slack integration

Liminal connects to **Slack** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never paste Slack tokens into `.env`.

This is a **harness integration only** (Settings → Integrations). It is not used for website account login.

## Connect

1. Run Liminal web UI or desktop.
2. **Settings → Integrations → Slack → Connect**.
3. Complete Slack consent in the browser tab.
4. Close the tab when you see **Connected** — tokens are stored under `~/.liminal/oauth/slack/`.

Or: `connect_provider({ provider: "slack" })` after OAuth is on disk.

### Direct OAuth (recommended if scopes stay missing via Vireon)

Slack **user tokens** require `user_scope=` on `oauth/v2/authorize` — not bot `scope=`. If hosted connect keeps returning a thin token, use **direct loopback OAuth**:

1. Slack app → **OAuth & Permissions** → Redirect URL:

   ```
   http://127.0.0.1:38476/oauth/slack/callback
   ```

2. Add to `.env` (desktop bundle copies this file):

   ```
   SLACK_OAUTH_CLIENT_ID=...
   SLACK_OAUTH_CLIENT_SECRET=...
   ```

3. Register all user token scopes from the table below on the Slack app.

4. Set `SLACK_OAUTH_DIRECT=1` in `.env`, then Disconnect + Connect Slack (hosted Vireon is the default).

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

3. **User Token Scopes** (not bot scopes) — harness requests these explicitly via `scopes=` on the connect URL. Names match [Slack method docs](https://docs.slack.dev/reference/methods/) user-token scopes:

   | Harness tool / API | User scopes |
   | ------------------ | ----------- |
   | `slack_list_channels`, `slack_list_dms` | `channels:read`, `groups:read`, `im:read`, `mpim:read` |
   | `slack_list_users` | `users:read` |
   | `slack_get_channel_history`, `slack_get_thread_replies` | `channels:history`, `groups:history`, `im:history`, `mpim:history` |
   | `slack_search_messages` | `search:read` |
   | `slack_post_message`, `slack_reply_in_thread` | `chat:write` |
   | `slack_add_reaction` | `reactions:write` |
   | `slack_open_dm` | `channels:write`, `groups:write`, `im:write`, `mpim:write` |
   | `slack_upload_file` | `files:write` |

   **Read+write OAuth request (17 scopes):** all rows above.

4. Vercel env: `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`.

5. **Vireon `/connect/slack` handler** must pass harness `user_scope` (or `scopes`) query param through to Slack as **`user_scope=`** on `https://slack.com/oauth/v2/authorize`. Passing bot `scope=` only does not grant user-token permissions.

6. Register every scope in the table on the Slack app under **OAuth & Permissions → User Token Scopes**, then reinstall / have users reconnect.
