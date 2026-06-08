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
| `slack_list_users` | Workspace members |
| `slack_get_channel_history` | Recent messages in a channel |
| `slack_post_message` | Post to a channel (approval required) |

Disable with `AGENT_SLACK_REST=0`.

## Operator setup (Vireon — one time)

1. [Slack API](https://api.slack.com/apps) → **Create New App** → From scratch.
2. **OAuth & Permissions** → add **Redirect URL**:

   ```
   https://www.vireondynamics.com/connect/slack/callback
   ```

3. **User Token Scopes** (not bot scopes): `channels:history`, `channels:read`, `groups:history`, `groups:read`, `im:history`, `im:read`, `mpim:history`, `mpim:read`, `users:read`, and `chat:write` for read+write mode.
4. Vercel env: `SLACK_OAUTH_CLIENT_ID`, `SLACK_OAUTH_CLIENT_SECRET`.
