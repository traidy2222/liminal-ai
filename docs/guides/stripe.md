# Stripe integration

Liminal connects to **Stripe** through **Stripe Connect OAuth** on [vireondynamics.com](https://www.vireondynamics.com) — users never create their own Connect application.

Harness integration only — not website billing login.

## Connect

1. **Settings → Integrations → Stripe → Connect**.
2. Complete Stripe Connect consent in the browser tab.
3. Tokens persist under `~/.liminal/oauth/stripe/`.

Or: `liminal connect stripe` or `connect_provider({ provider: "stripe" })`.

### Read vs write

- **Read + write**: list/get customers, subscriptions, invoices, charges; create refunds and cancel subscriptions (writes are approval-gated).
- **Read only**: account, balance, and read-only list/get endpoints.

## Agent tools

| Tool | Purpose |
| ---- | ------- |
| `stripe_get_account` | Connected account details |
| `stripe_get_balance` | Available and pending balance |
| `stripe_list_customers` | Customer list |
| `stripe_get_customer` | Customer by id |
| `stripe_list_subscriptions` | Subscription list |
| `stripe_get_subscription` | Subscription by id |
| `stripe_list_invoices` | Invoice list |
| `stripe_get_invoice` | Invoice by id |
| `stripe_list_charges` | Charge list |
| `stripe_get_charge` | Charge by id |
| `stripe_list_products` | Product list |
| `stripe_create_refund` | Refund a charge (approval required) |
| `stripe_cancel_subscription` | Cancel subscription (approval required) |

Disable with `AGENT_STRIPE_REST=0`.

## Operator setup (Vireon — one time)

1. [Stripe Dashboard → Connect → Settings](https://dashboard.stripe.com/settings/connect) → enable Connect and create a **Connect application** (client id starts with `ca_`).
2. **Redirect URI**:

   ```
   https://www.vireondynamics.com/connect/stripe/callback
   ```

3. Vercel env:
   - `STRIPE_OAUTH_CLIENT_ID` — Connect application client id (`ca_…`)
   - `STRIPE_OAUTH_SECRET_KEY` — platform secret key (`sk_…`), or reuse `STRIPE_SECRET_KEY`

Hosted token refresh uses `liminal login` (license Bearer) when the platform secret is not on the customer machine.
