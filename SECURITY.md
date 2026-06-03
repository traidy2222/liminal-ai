# Security

## Reporting

Email **admin@vireondynamics.com** with steps to reproduce. Do not open public issues for unfixed vulnerabilities.

## Public vs private components

| Component | Repository | Secrets |
|-----------|------------|---------|
| Harness (CE) | `liminal-ai` (this repo) | None — API keys in local `.env` only |
| License **verification** | `packages/core/src/entitlements.ts` | **Public** Ed25519 key only (expected) |
| Billing, org admin, Stripe | **Private** `vireondynamics-website` | Vercel env: Stripe, Supabase service role, license **private** key |

The Express `@liminal/control-plane` package was **removed from this public tree** so billing routes, org RBAC, and SQL migrations are not published alongside CE. Production uses embedded billing in the private Next.js app.

## What must never be committed

- `CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM`
- `SUPABASE_SERVICE_ROLE_KEY` / `sb_secret_*`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `AGENT_API_KEY`, `RESEND_API_KEY`, or any provider secret
- `.env`, `.env.vercel.*`, `private/*.pem`

CI runs `npm run verify:repo-secrets` and `npm run verify-harness-defaults-no-secrets`.

## License tokens

- Tokens are signed server-side; the harness verifies with the public key offline.
- Compromise of the **private** key allows forging licenses — rotate keypair and re-issue via Stripe reconciliation.
- `/api/license/verify` only validates tokens; it cannot mint them.

## Self-hosters

Run billing on infrastructure you control. Keep the signing private key in server env only. Apply RLS migrations from the operator repo; use the service role only on the server, never in the browser.
