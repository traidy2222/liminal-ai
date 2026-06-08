# GitHub integration

Liminal connects to GitHub through the **official GitHub MCP** (`mcp_github_*`) at `https://api.githubcopilot.com/mcp/`.

## Connect once (recommended)

### 1. Connect in UI

**Settings → Integrations → GitHub → Connect**

Opens `vireondynamics.com/connect/github`, stores encrypted tokens under `~/.liminal/oauth/github/`, and attaches MCP tools for issues, pull requests, and repositories.

No `GITHUB_OAUTH_CLIENT_ID` in your local `.env` — OAuth runs on Vireon-hosted GitHub OAuth app.

### 2. Optional legacy PAT

```env
GITHUB_TOKEN=ghp_...
# GITHUB_TOKEN_ENV=GITHUB_TOKEN   # alternate env var name
# AGENT_GITHUB_MCP=1              # default on; set 0 to disable
# AGENT_GITHUB_CONNECT_ON_BOOT=1  # auto-attach when token/OAuth present
```

### 3. Hosted OAuth flow

```
Liminal (local) → opens vireondynamics.com/connect/github?redirect_uri=…&state=…
                → GitHub consent
                → site /connect/github/callback (token exchange)
                → form POST → http://127.0.0.1:<port>/api/integrations/oauth/handoff
                → ~/.liminal/oauth/github/
```

### 4. Agent tools

| User ask | Tool path |
|----------|-----------|
| List/search repos | `mcp_github_*` |
| Issues & PRs | `mcp_github_*` |
| Read org membership | `mcp_github_*` |

Use **read_only** mode in Integrations to attach the readonly MCP endpoint when you only need read access.

## Vireon site operator setup (one time)

1. [GitHub Developer Settings](https://github.com/settings/developers) → **OAuth Apps** → app used by Vireon
2. **Authorization callback URL**: `https://www.vireondynamics.com/connect/github/callback`
3. Vercel env: `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`

## Manual test checklist

1. Connect GitHub in Integrations (read_write mode)
2. Ask agent to list your repositories
3. Open or create an issue on a test repo
4. Disconnect with **Revoke GitHub access** to clear tokens
