# @liminal/control-plane

Vireon **control plane** — Stripe subscriptions, Supabase entitlements, and Ed25519 license issuance for Liminal EE.

The marketing site lives in a separate repo (`website/`, gitignored here). This package is the billing backend you deploy beside it (or mount into that repo).

## Architecture

```
Stripe Checkout / Portal
        ↓ webhooks
@liminal/control-plane  ──sign──►  license token (same format as packages/core entitlements.ts)
        ↓
Supabase (profiles, subscriptions, licenses)
        ↓ GET /api/license/me
Harness / dashboard  ──AGENT_LICENSE_KEY──►  offline verify + grace cache
```

- **Sign:** `signLicenseToken` from `@liminal/core` (private key only in control-plane env).
- **Verify:** harness uses the public key in `VIREON_LICENSE_PUBLIC_KEY_PEM` (or `AGENT_LICENSE_PUBLIC_KEY`).

## Setup

### 1. License keys

```bash
npm run keys:generate -w @liminal/control-plane
```

- Put the **private** PEM in `.env` as `CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM`.
- Paste the **public** PEM into `packages/core/src/entitlements.ts` (`VIREON_LICENSE_PUBLIC_KEY_PEM`) so issued tokens verify in the harness.

### 2. Supabase

Create a project, enable Auth (email magic link or OAuth), then apply the schema:

```bash
# from packages/control-plane
supabase db push
# or run supabase/migrations/20260531000000_billing_schema.sql in the SQL editor
```

Copy `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_ANON_KEY` into `.env`.

### 3. Stripe

1. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env` (use Dashboard → Developers → Webhooks → endpoint `https://<host>/api/stripe/webhook`, events: `checkout.session.completed`, `customer.subscription.*`).
2. Create prices (or run the bootstrap script):

```bash
STRIPE_SECRET_KEY=sk_test_... node packages/control-plane/scripts/stripe-bootstrap-prices.mjs
```

3. Add the printed `STRIPE_PRICE_*` lines to `.env`.

**Never commit API keys.** Rotate any key that was pasted into chat or logs.

### 4. Run

```bash
npm run build -w packages/core
npm run build -w @liminal/control-plane
npm run start -w @liminal/control-plane
# default :3002
```

## API

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `GET` | `/health` | — | Liveness |
| `POST` | `/api/license/verify` | — | Verify token + return tier/entitlements |
| `GET` | `/api/license/me` | Supabase JWT | Active license for signed-in user |
| `POST` | `/api/billing/checkout` | Supabase JWT | `{ "tier": "pro" \| "team" \| "enterprise" }` → Checkout URL |
| `POST` | `/api/billing/portal` | Supabase JWT | Stripe Customer Portal URL |
| `POST` | `/api/stripe/webhook` | Stripe signature | Subscription lifecycle → issue/revoke licenses |

### Website integration

Point the site API proxy (or `VITE_CONTROL_PLANE_URL`) at this service:

- **Pricing page:** `POST /api/billing/checkout` with the user's Supabase session bearer token.
- **Dashboard:** `GET /api/license/me` → show token + copy for `AGENT_LICENSE_KEY`.
- **Local harness:** paste token or set `AGENT_LICENSE_KEY` in `.env`.

## Env reference

See [`.env.example`](./.env.example).
