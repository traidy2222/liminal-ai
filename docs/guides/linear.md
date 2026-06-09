# Linear integration

Liminal connects to **Linear** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never create their own Linear OAuth app.

Harness integration only — not website account login.

## Connect

1. **Settings → Integrations → Linear → Connect**.
2. Complete Linear consent in the browser tab.
3. Tokens persist under `~/.liminal/oauth/linear/`.

Or: `connect_provider({ provider: "linear" })`.

### Read vs write

- **Read + write**: list/search/get issues, users, labels, cycles, projects; create/update issues, comments, labels, projects; archive/delete (writes are approval-gated).
- **Read only**: teams, issues, issue details, search.

## Agent tools

### Discovery & search

| Tool | Purpose |
| ---- | ------- |
| `linear_get_viewer` | Connected user (id, email, organization) |
| `linear_list_teams` | Teams in the workspace |
| `linear_list_users` | Workspace members |
| `linear_list_team_members` | Members of one team (`team_key` or `team_id`) |
| `linear_list_workflow_states` | Workflow states — use before status changes |
| `linear_list_labels` | Issue labels (optional `team_key`) |
| `linear_list_cycles` | Sprints/cycles (optional `team_key`, `active_only`) |
| `linear_list_projects` | Projects (optional `team_id`) |
| `linear_list_issues` | Issue list; filter by team, `state_name`, `assignee_email` |
| `linear_list_my_issues` | Issues assigned to the connected user |
| `linear_search_issues` | Full-text search (`query` or `q`) |
| `linear_get_issue` | Full issue detail by uuid or `ENG-42` (labels, cycle, parent, sub-issues) |
| `linear_list_comments` | Comments on an issue |

### Issues (writes — approval required)

| Tool | Purpose |
| ---- | ------- |
| `linear_create_issue` | Create; `team_key` or `team_id`, labels, cycle, parent, project, estimate, due date |
| `linear_update_issue` | Patch title, description, state, priority, project, cycle, parent, labels, estimate, due date |
| `linear_assign_issue` | Assign by id, email, or name; empty `assignee_id` unassigns |
| `linear_add_comment` | Comment on uuid or **ENG-42** |
| `linear_set_issue_labels` | Replace all labels (`label_names` or `label_ids`) |
| `linear_add_issue_labels` | Add labels without removing existing |
| `linear_set_issue_cycle` | Add issue to sprint/cycle |
| `linear_link_sub_issue` | Set parent issue (sub-task) |
| `linear_archive_issue` | Archive (soft delete) |
| `linear_delete_issue` | Permanent delete |
| `linear_attach_url` | Link external URL to issue |

### Projects & labels (writes — approval required)

| Tool | Purpose |
| ---- | ------- |
| `linear_create_label` | New label on a team |
| `linear_create_project` | New project |
| `linear_update_project` | Rename or update project state / target date |

**Agent tips**

- **Args are flexible:** `issue`, `issue_id`, and `identifier` are interchangeable (e.g. `VIP-1`). `team` / `team_key` work instead of `team_id`. `status` maps to `state_name`. `priority` is 0–4 (urgent=1).
- Run `linear_list_teams` first to get `team_key` (e.g. VIP) for `linear_create_issue`.
- Use `state_name` (e.g. Done, In Progress) instead of hunting UUIDs — run `linear_list_workflow_states` first if unsure.
- Issue identifiers (`ENG-42`) work anywhere `issue` or `issue_id` is accepted.
- Use `linear_get_viewer` + `linear_list_my_issues` for “my tickets”.
- Prefer `linear_archive_issue` over `linear_delete_issue` unless the user explicitly wants permanent deletion.

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
