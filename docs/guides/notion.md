# Notion integration

Liminal connects to **Notion** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never create their own Notion OAuth app.

Harness integration only — not website account login.

## Connect

1. **Settings → Integrations → Notion → Connect**.
2. Pick pages/databases to share when Notion prompts you.
3. Tokens persist under `~/.liminal/oauth/notion/`.

Or: `liminal connect notion` or `connect_provider({ provider: "notion" })`.

### Read vs write

- **Read + write**: search, read pages/databases, create/update pages, append blocks (writes are approval-gated).
- **Read only**: search and read tools only (harness mode; your Notion integration must allow read content).

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `notion_search` | Search pages and databases |
| `notion_get_page` | Page metadata and properties |
| `notion_list_block_children` | Page body blocks |
| `notion_get_database` | Database schema |
| `notion_query_database` | Query database rows |
| `notion_create_page` | Create page or row (approval required) |
| `notion_update_page` | Update properties (approval required) |
| `notion_append_blocks` | Append blocks to a page (approval required) |

Disable with `AGENT_NOTION_REST=0`.

## Operator setup (Vireon — one time)

1. [Notion → My integrations](https://www.notion.so/my-integrations) → **New integration**.
2. Type: **Public** (OAuth). Name it e.g. **Liminal**.
3. **Redirect URI**:

   ```
   https://www.vireondynamics.com/connect/notion/callback
   ```

4. Capabilities: enable **Read content**, **Update content**, and **Insert content** (read-only harness mode still gates write tools).
5. Copy **OAuth client ID** and **OAuth client secret**.
6. Vercel env (Production): `NOTION_OAUTH_CLIENT_ID`, `NOTION_OAUTH_CLIENT_SECRET`.
7. Deploy the website, rebuild the harness, then test `liminal connect notion`.
