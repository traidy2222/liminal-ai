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

### Discovery (use before creates)

| Tool | Purpose |
| ---- | ------- |
| `xero_find_contact` | Search contacts by name/email |
| `xero_list_bank_accounts` | Bank AccountIDs for payments & bank txns |
| `xero_suggest_line_item` | Default AccountCode + TaxType for sales/purchase lines |

### Invoices & AR/AP

| Tool | Purpose |
| ---- | ------- |
| `xero_list_invoices` | List invoices and bills |
| `xero_get_invoice` | Fetch one by GUID |
| `xero_create_invoice` | Create ACCREC sales invoice (approval) |
| `xero_create_bill` | Create ACCPAY supplier bill (approval) |
| `xero_set_invoice_status` | Approve/void (minimal payload) |
| `xero_update_invoice` | Update lines/dates (not status) |
| `xero_authorise_and_email_invoice` | Approve + email in one step (approval) |
| `xero_record_invoice_payment` | Pay invoice/bill (defaults to AmountDue) |
| `xero_quote_to_invoice` | Convert quote → invoice (approval) |
| `xero_po_to_bill` | Convert PO → supplier bill (approval) |
| `xero_email_invoice` | Email authorised invoice (approval) |
| `xero_list_credit_notes` | Credit notes |
| `xero_create_credit_note` | Create credit note (approval) |
| `xero_list_purchase_orders` | Purchase orders |
| `xero_list_quotes` | Sales quotes |
| `xero_list_items` | Inventory / service items |
| `xero_get_item` / `xero_create_item` / `xero_update_item` | Item catalog |

### Contacts

| Tool | Purpose |
| ---- | ------- |
| `xero_list_contacts` | Customers/suppliers |
| `xero_get_contact` | One contact by GUID |
| `xero_create_contact` | Create contact (approval) |
| `xero_update_contact` | Update contact (approval) |

### Quotes, POs, credit notes (lifecycle)

| Tool | Purpose |
| ---- | ------- |
| `xero_set_quote_status` / `xero_update_quote` | Quote status & edits |
| `xero_set_purchase_order_status` / `xero_update_purchase_order` | PO status & edits |
| `xero_set_credit_note_status` / `xero_update_credit_note` | Credit note status & edits |
| `xero_allocate_credit_note` | Apply credit note to invoice/bill |

### Cash & journals

| Tool | Purpose |
| ---- | ------- |
| `xero_list_payments` | Payments on invoices |
| `xero_get_payment` / `xero_delete_payment` | Fetch or void a payment |
| `xero_create_payment` | Record payment (approval) |
| `xero_allocate_overpayment` / `xero_allocate_prepayment` | Apply unallocated cash |
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
| `xero_report_tax_summary` | GST / tax summary (BAS prep) |

Pass `fromDate`, `toDate`, or `date` (YYYY-MM-DD) where applicable.

### Attachments

| Tool | Purpose |
| ---- | ------- |
| `xero_list_attachments` | List files on invoice/bill/PO/quote/etc. |
| `xero_get_attachment` | Download by file name (`save_path` or base64) |
| `xero_upload_attachment` | Upload PDF/image from workspace path or base64 (approval) |
| `xero_delete_attachment` | Remove attachment (approval) |

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

## Phase 3 — GL journals, Files, Projects, Payroll

Requires **reconnect** after upgrade (new OAuth scopes: `accounting.journals.read`, `files`, `projects`, `payroll.*`).

### General ledger journals

| Tool | Purpose |
| ---- | ------- |
| `xero_list_journals` | Posted GL journal lines |
| `xero_get_journal` | One journal by JournalID |
| `xero_get_journal_by_number` | One journal by number |

### Files cabinet (org-wide)

| Tool | Purpose |
| ---- | ------- |
| `xero_files_list` / `xero_files_get` | Browse file metadata |
| `xero_files_download` | Save to workspace or base64 |
| `xero_files_upload` / `xero_files_delete` | Manage files (approval on write) |
| `xero_files_list_folders` / `xero_files_get_folder` | Folder structure |
| `xero_files_list_associations` | Links to invoices, contacts, etc. |

### Projects (job costing / time)

| Tool | Purpose |
| ---- | ------- |
| `xero_list_projects` / `xero_get_project` | Projects with WIP totals |
| `xero_create_project` / `xero_update_project` | Project lifecycle |
| `xero_list_project_tasks` / `xero_create_project_task` | Billable tasks |
| `xero_list_project_time_entries` / `xero_create_project_time_entry` | Time logging |
| `xero_list_project_users` | Users assignable to time |

### Payroll (AU v1.0 / UK+NZ v2.0)

| Tool | Purpose |
| ---- | ------- |
| `xero_payroll_region` | Detect AU vs UK vs NZ from org country |
| `xero_list_payroll_employees` / `xero_get_payroll_employee` | Staff records |
| `xero_list_payroll_payruns` / `xero_get_payroll_payrun` | Pay run status |
| `xero_list_payroll_timesheets` / `xero_get_payroll_timesheet` | Timesheets |
| `xero_get_payroll_settings` | Payroll org config |
| `xero_get_payroll_payslip` | Payslip detail |
| `xero_create_payroll_timesheet` | Create draft timesheet (approval) |

Pass `payroll_region` (`AU` \| `UK` \| `NZ`) to override auto-detection.

### Bank feeds (not available)

`xero_bank_feeds_info` — direct bank feed import requires Xero **partner** approval and is not in hosted OAuth. Use bank transactions + linked transactions instead.

## Phase 3.5 — composites, payroll writes, accounting mutations

### Composites

| Tool | Purpose |
| ---- | ------- |
| `xero_upsert_contact` | Find by email/name → update or create |
| `xero_project_to_invoice` | Bill unbilled project time (grouped by task) |
| `xero_month_end_close` | P&L, BS, trial, aged AR/AP, bank + close checklist |
| `xero_duplicate_invoice_check` | Match reference/number/amount before creating |

### Payroll writes

| Tool | Purpose |
| ---- | ------- |
| `xero_create_payroll_payrun` | Draft pay run for calendar period |
| `xero_update_payroll_payrun` | Post/finalise pay run |
| `xero_update_payroll_employee` | Update employee record |
| `xero_update_payroll_timesheet` | Correct timesheet lines |

### Accounting mutations

| Tool | Purpose |
| ---- | ------- |
| `xero_update_bank_transaction` / `xero_void_bank_transaction` | Fix or remove bank lines |
| `xero_create_account` / `xero_update_account` | Chart of accounts |
| `xero_create_tracking_category` / `xero_create_tracking_option` / `xero_update_tracking_category` | Tracking dimensions |
| `xero_list_expense_claims` / `xero_get_expense_claim` / `xero_create_expense_claim` | Staff reimbursements |
| `xero_update_repeating_invoice` / `xero_delete_repeating_invoice` | Recurring billing lifecycle |
| `xero_send_invoice_reminder` | Payment reminder email |
| `xero_list_budgets` / `xero_get_budget` | Budget vs actual |

## Troubleshooting

- **"Harness rejected handoff"** / **"Failed to fetch"** / **CSP `form-action`** — Liminal must be running (`liminal web` or desktop) before Connect. The site POSTs tokens to loopback (`127.0.0.1` or `localhost`, dynamic port on desktop). Update vireondynamics.com if you see `form-action 'self'` blocked.
- **No organisation** — reconnect; the harness stores the first linked tenant from `GET /connections`.
- **403 on API calls** — wrong tenant or missing scope; revoke in Integrations and reconnect with the mode you need.
- **`invalid_scope` on Xero sign-in** — Liminal defaults to **legacy broad OAuth scopes** (`accounting.transactions`, `accounting.reports.read`) for apps created before 2026-03-02. Reconnect with **Extended APIs unchecked** first. If you created your Xero app on/after 2026-03-02, set `AGENT_XERO_OAUTH_SCOPE_STYLE=granular` (and `XERO_OAUTH_SCOPE_STYLE=granular` on Vercel). Do not request deprecated `accounting.classicexpenses` or `accounting.budgets.read` scopes.
- **Supabase “invalid flow state” after Xero consent** — Xero `?code=` was misrouted to `/auth/callback` (especially when the redirect URI omitted `/callback`). Deploy latest vireondynamics.com connect middleware, confirm the Xero app redirect URI ends with `/connect/xero/callback`, clear cookies for vireondynamics.com, retry in a private window.
