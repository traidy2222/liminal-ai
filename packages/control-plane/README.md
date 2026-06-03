# Billing & control plane (not in this repository)

**Stripe billing, Supabase entitlements, org admin APIs, and license signing are not shipped in the public `liminal-ai` repo.** That reduces exposure of billing logic, org RBAC, and database schema to the open-source tree.

## Where it lives

| Environment | Location |
|-------------|----------|
| **Vireon production** | Private [vireondynamics-website](https://github.com/traidy2222/vireondynamics-website) — embedded billing in Next.js (`src/lib/billing/embedded/`, `src/lib/team/`, `src/app/api/*`) |
| **Self-hosted / enterprise** | Deploy your own operator stack; use the same schema under `supabase/migrations/` in the website repo. Do not expose `CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM` in client bundles. |

## Community Edition (this repo)

- Harness verifies licenses with the **public** Ed25519 key in `packages/core/src/entitlements.ts` (`VIREON_LICENSE_PUBLIC_KEY_PEM`).
- Optional override: `AGENT_LICENSE_PUBLIC_KEY` / `AGENT_LICENSE_KEY` in `.env`.
- No private signing key belongs in this repository.

## Operators

1. Generate a keypair (monorepo root): `npm run keys:generate`
2. Private PEM → server env only (`CONTROL_PLANE_LICENSE_PRIVATE_KEY_PEM` on Vercel).
3. Public PEM → `VIREON_LICENSE_PUBLIC_KEY_PEM` in `entitlements.ts` (or env on custom builds).
4. Migrations & runbooks: `vireondynamics-website` → `docs/BILLING.md`, `docs/SECURITY.md`, `supabase/migrations/`.

## Historical note

`@liminal/control-plane` (Express package) previously lived here for local dev parity. It was removed from the public tree in favor of the private website deployment. If you need a standalone HTTP service, run the website app or maintain a private fork.

See [SECURITY.md](../../SECURITY.md) at the repo root.
