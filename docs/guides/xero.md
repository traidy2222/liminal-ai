# Xero integration

Liminal connects to **Xero Accounting** through **hosted OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never create their own Xero app or paste client secrets into `.env`.

## Connect (recommended)

1. Run Liminal web UI (`liminal web` or `npm run web:dev`).
2. **Settings → Integrations → Xero → Connect**.
3. Complete Xero consent in the browser tab.
4. Close the tab when you see **Connected** — tokens are stored under `~/.liminal/oauth/xero/`.

Or ask the agent: `connect_provider({ provider: "xero" })` after OAuth is on disk.

### Read vs write

- **Read + write** (default): full accounting toolset — list/get org settings, invoices, bills, contacts, payments, bank transactions, journals, and financial reports; create/update drafts (writes are approval-gated).
- **Read only**: granular read scopes — reconnect to change mode.

**After upgrading Liminal** (or if tools return HTTP 401 `AuthorizationUnsuccessful` on payments, bank, journals, or reports): **Disconnect** Xero in Settings → Integrations, then **Connect** again with **Read + write**. OAuth tokens keep the scopes granted at connect time — refresh does not add new ones. The hosted connect site must also be deployed with the full granular scope list.

## Agent tools

Activate the **xero** family if lazy loading is on: `activate_tool_family({ family: "xero" })`.

Disable REST tools with `AGENT_XERO_REST=0`.

### Organisation & settings

| Tool | Purpose |
| ---- | ------- |
| `xero_list_organisations` | Linked Xero orgs (tenant ids) |
| `xero_get_organisation` | Org profile, currency, financial year |
| `xero_list_accounts` | Chart of accounts |
| `xero_get_account` | One account by GUID |
| `xero_list_tax_rates` | Tax / GST codes |
| `xero_list_tracking_categories` | Tracking dimensions |

### Invoices & AR/AP

| Tool | Purpose |
| ---- | ------- |
| `xero_list_invoices` | List invoices and bills |
| `xero_get_invoice` | Fetch one by GUID |
| `xero_create_invoice` | Create ACCREC sales invoice (approval) |
| `xero_create_bill` | Create ACCPAY supplier bill (approval) |
| `xero_update_invoice` | Update status/lines (approval) |
| `xero_email_invoice` | Email authorised invoice (approval) |
| `xero_list_credit_notes` | Credit notes |
| `xero_create_credit_note` | Create credit note (approval) |
| `xero_list_purchase_orders` | Purchase orders |
| `xero_list_quotes` | Sales quotes |
| `xero_list_items` | Inventory / service items |

### Contacts

| Tool | Purpose |
| ---- | ------- |
| `xero_list_contacts` | Customers/suppliers |
| `xero_get_contact` | One contact by GUID |
| `xero_create_contact` | Create/update contact (approval) |

### Cash & journals

| Tool | Purpose |
| ---- | ------- |
| `xero_list_payments` | Payments on invoices |
| `xero_create_payment` | Record payment (approval) |
| `xero_list_bank_transactions` | Spent/received money |
| `xero_create_bank_transaction` | Create bank txn (approval) |
| `xero_list_manual_journals` | Manual journals |
| `xero_create_manual_journal` | Create journal (approval) |

### Reports

| Tool | Purpose |
| ---- | ------- |
| `xero_report_profit_and_loss` | P&L |
| `xero_report_balance_sheet` | Balance sheet |
| `xero_report_trial_balance` | Trial balance |
| `xero_report_aged_receivables` | Who owes you |
| `xero_report_aged_payables` | What you owe |
| `xero_report_bank_summary` | Bank balances |
| `xero_report_executive_summary` | Dashboard summary |

Pass `fromDate`, `toDate`, or `date` (YYYY-MM-DD) where applicable.

### Attachments

| Tool | Purpose |
| ---- | ------- |
| `xero_list_attachments` | List files on invoice/bill/PO/quote/etc. |
| `xero_get_attachment` | Download by file name (`save_path` or base64) |
| `xero_upload_attachment` | Upload PDF/image from workspace path or base64 (approval) |

`parent_type`: `Invoices`, `CreditNotes`, `PurchaseOrders`, `Quotes`, `BankTransactions`, `Contacts`, `Accounts`, `ManualJournals`.

### Reconciliation & batch

| Tool | Purpose |
| ---- | ------- |
| `xero_list_batch_payments` | Payment runs |
| `xero_create_batch_payment` | Pay multiple invoices from one bank account (approval) |
| `xero_list_repeating_invoices` | Recurring invoice templates |
| `xero_get_repeating_invoice` | One template by GUID |
| `xero_create_repeating_invoice` | Create template (approval) |
| `xero_list_linked_transactions` | Bank line ↔ document links |
| `xero_create_linked_transaction` | Create reconciliation link (approval) |
| `xero_list_overpayments` / `xero_get_overpayment` | Customer/supplier overpayments |
| `xero_list_prepayments` / `xero_get_prepayment` | Prepayments |
| `xero_list_bank_transfers` | Inter-account transfers |
| `xero_create_bank_transfer` | Move cash between bank accounts (approval) |

### Quotes & purchase orders (create)

| Tool | Purpose |
| ---- | ------- |
| `xero_get_quote` / `xero_create_quote` | Fetch or draft a quote |
| `xero_get_purchase_order` / `xero_create_purchase_order` | Fetch or draft a PO |

### Settings (extra)

| Tool | Purpose |
| ---- | ------- |
| `xero_list_branding_themes` | Invoice branding |
| `xero_list_currencies` | Org currencies |

### Escape hatch

| Tool | Purpose |
| ---- | ------- |
| `xero_request` | Raw Accounting API call for uncovered endpoints (approval-gated) |

## Operator setup (Vireon — one time)

Register a **Web app** at [developer.xero.com](https://developer.xero.com/myapps):

| Field | Value |
| ----- | ----- |
| App name | `Liminal AI` |
| Integration type | Web app |
| AI training on Xero data? | **No** |
| Security requirements | **Yes** |
| Company URL | `https://www.vireondynamics.com/liminal` |
| Redirect URI | `https://www.vireondynamics.com/connect/xero/callback` (must include `/callback` — not `/connect/xero` alone) |

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

## Roadmap (Phase 3 — not yet in Liminal)

- **Payroll** (AU/UK/NZ) — separate `payroll.*` scopes and API base URLs
- **Files API** — org-wide file cabinet (distinct from document attachments)
- **Projects** — time/cost tracking API
- **Bank feeds** — partner-only
- **General ledger journals** — `accounting.journals.read` (requires Xero partner approval)

Use `xero_request` for one-off endpoints until dedicated tools land.

## Troubleshooting

- **"Harness rejected handoff"** / **"Failed to fetch"** / **CSP `form-action`** — Liminal must be running (`liminal web` or desktop) before Connect. The site POSTs tokens to loopback (`127.0.0.1` or `localhost`, dynamic port on desktop). Update vireondynamics.com if you see `form-action 'self'` blocked.
- **No organisation** — reconnect; the harness stores the first linked tenant from `GET /connections`.
- **403 on API calls** — wrong tenant or missing scope; revoke in Integrations and reconnect with the mode you need.
- **`invalid_scope` on Xero sign-in** — Xero apps created after 2026-03-02 require granular scopes (`accounting.invoices`, not legacy `accounting.transactions`). Redeploy the latest vireondynamics.com connect routes.
- **Supabase “invalid flow state” after Xero consent** — Xero `?code=` was misrouted to `/auth/callback` (especially when the redirect URI omitted `/callback`). Deploy latest vireondynamics.com connect middleware, confirm the Xero app redirect URI ends with `/connect/xero/callback`, clear cookies for vireondynamics.com, retry in a private window.
