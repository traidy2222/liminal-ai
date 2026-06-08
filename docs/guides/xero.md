# Xero integration

Liminal connects to **Xero Accounting** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never create their own Xero app or paste client secrets into `.env`.

## Connect (recommended)

1. Run Liminal web UI (`liminal web` or `npm run web:dev`).
2. **Settings → Integrations → Xero → Connect**.
3. Complete Xero consent in the browser tab.
4. Close the tab when you see **Connected** — tokens are stored under `~/.liminal/oauth/xero/`.

Or ask the agent: `connect_provider({ provider: "xero" })` after OAuth is on disk.

### Read vs write

- **Read + write** (default): list/get invoices & contacts, create draft sales invoices (`xero_create_invoice` is approval-gated).
- **Read only**: invoices/contacts/settings read scopes only — reconnect to change mode.

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `xero_list_organisations` | Linked Xero orgs (tenant ids) |
| `xero_list_invoices` | List invoices (optional status filter) |
| `xero_get_invoice` | Fetch one invoice by GUID |
| `xero_list_contacts` | Customers/suppliers |
| `xero_create_invoice` | Create ACCREC draft invoice (approval required) |

Activate the **connectors** family if lazy loading is on: `activate_tool_family({ family: "connectors" })`.

Disable REST tools with `AGENT_XERO_REST=0`.

## Operator setup (Vireon — one time)

Register a **Web app** at [developer.xero.com](https://developer.xero.com/myapps):

| Field | Value |
| ----- | ----- |
| App name | `Liminal AI` |
| Integration type | Web app |
| AI training on Xero data? | **No** |
| Security requirements | **Yes** |
| Company URL | `https://www.vireondynamics.com/liminal` |
| Redirect URI | `https://www.vireondynamics.com/connect/xero/callback` |

Add to **Vercel** env for `vireondynamics-website` (not the user's `.env`):

```env
XERO_OAUTH_CLIENT_ID=...
XERO_OAUTH_CLIENT_SECRET=...
INTEGRATION_OAUTH_STATE_SECRET=...   # optional HMAC for OAuth state; defaults to client secret
```

## Architecture

```text
Liminal (local) → opens vireondynamics.com/connect/xero
                → Xero consent
                → site /connect/xero/callback (token exchange)
                → POST tokens to localhost:3001/api/integrations/oauth/handoff
                → ~/.liminal/oauth/xero/<account>.json (encrypted)
```

Same hosted handoff pattern as Vireon license connect (`/connect/harness`).

## Troubleshooting

- **"Harness rejected handoff"** — Liminal web server must be running on `:3001` when you finish Xero sign-in.
- **No organisation** — reconnect; the harness stores the first linked tenant from `GET /connections`.
- **403 on API calls** — wrong tenant or missing scope; revoke in Integrations and reconnect with the mode you need.
- **`invalid_scope` on Xero sign-in** — Xero apps created after 2026-03-02 require granular scopes (`accounting.invoices`, not legacy `accounting.transactions`). Redeploy the latest vireondynamics.com connect routes.
- **Supabase “invalid flow state” after Xero consent** — site middleware was misrouting Xero `?code=` to `/auth/callback`. Update vireondynamics.com to the latest connect middleware fix and retry.
