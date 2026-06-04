# Google Workspace integration

Liminal connects to Google Workspace through a **hybrid MCP architecture**:

- **Official Google MCP** (preview): Drive, Gmail, Calendar, Chat, People
- **Community sidecar** (`workspace-mcp` via `uvx`): Docs, Sheets, Slides, Forms, Tasks, Contacts, Apps Script, Custom Search

## Prerequisites

1. Create a [Google Cloud project](https://console.cloud.google.com/) and enable the APIs you need.
2. Create an **OAuth 2.0 Client** (Desktop app or Web application).
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

## Connect

### Web

**Settings → Integrations** — three sections:

1. **Providers — Google Workspace** — OAuth, service picker, attach/detach
2. **Custom MCP** — attach any Streamable HTTP MCP server (`mcp_<name>_*` tools)
3. **OpenAPI** — import a JSON spec (`api_<name>_*` tools)

Secrets are referenced by env var name only; set tokens in `.env`.

### CLI

```bash
liminal connect google
liminal connect google --services drive,sheets,gmail --read-only
liminal disconnect google
```

### Agent

```
list_connectors
connect_provider({ provider: "google_workspace", services: ["drive", "sheets"], mode: "read_write" })
```

## Architecture

| Service | Backend |
|---------|---------|
| Drive, Gmail, Calendar, Chat, People | Official remote MCP |
| Docs, Sheets, Slides, Forms, Tasks, … | Local `workspace-mcp` sidecar on port 8010 |

Connections persist under `~/.liminal/api_connections/`. OAuth tokens are encrypted under `~/.liminal/oauth/google/`.

## Environment keys

| Key | Default | Purpose |
|-----|---------|---------|
| `AGENT_GOOGLE_SIDECAR_ENABLE` | `1` | Enable productivity sidecar |
| `AGENT_GOOGLE_SIDECAR_CMD` | `uvx workspace-mcp` | Sidecar launch command |
| `AGENT_GOOGLE_SIDECAR_PORT` | `8010` | Local MCP port |
| `AGENT_GOOGLE_CONNECT_ON_BOOT` | `0` | Auto-restore connections on harness start |

## Safety

- MCP **read** tools run without approval.
- MCP **write** tools require human approval (same as destructive shell/git tools).
- Use `mode: "read_only"` on `connect_provider` to register read tools only.

## Troubleshooting

- **OAuth error / no refresh token**: Revoke app access in [Google Account permissions](https://myaccount.google.com/permissions) and reconnect with `prompt=consent`.
- **Sidecar not ready**: Run `uvx workspace-mcp --help` manually; ensure port 8010 is free.
- **Tools invisible under lazy loading**: Call `list_connectors` or `activate_tool_family("connectors")`; restored Google connections auto-activate by default.
