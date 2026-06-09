# Linear integration

Liminal connects to **Linear** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never create their own Linear OAuth app.

Harness integration only — not website account login.

## Connect

1. **Settings → Integrations → Linear → Connect**.
2. Complete Linear consent in the browser tab.
3. Tokens persist under `~/.liminal/oauth/linear/`.

Or: `connect_provider({ provider: "linear" })`.

### Read vs write

- **Read + write**: list/get issues, create issues and comments (writes are approval-gated).
- **Read only**: teams, issues, issue details.

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `linear_list_teams` | Teams in the workspace |
| `linear_list_projects` | Projects (optional `team_id`) |
| `linear_list_issues` | Issue list (optional `team_id`) |
| `linear_get_issue` | Issue by uuid or identifier (e.g. `ENG-42`) |
| `linear_create_issue` | Create issue (approval required) |
| `linear_update_issue` | Update title, description, state, priority (approval required) |
| `linear_assign_issue` | Assign or unassign issue (approval required) |
| `linear_add_comment` | Comment on issue (approval required) |

With lazy loading: `activate_tool_family({ family: "linear" })`.

Disable with `AGENT_LINEAR_REST=0`.

## Operator setup (Vireon — one time)

1. [Linear Settings → API → OAuth applications](https://linear.app/settings/api/oauth-applications) → **New OAuth application**.
2. **Callback URL**:

   ```
   https://www.vireondynamics.com/connect/linear/callback
   ```

3. Scopes: `read`, `write`, `issues:create`, `comments:create` (read-only mode requests `read` only).
4. Vercel env: `LINEAR_OAUTH_CLIENT_ID`, `LINEAR_OAUTH_CLIENT_SECRET`.
