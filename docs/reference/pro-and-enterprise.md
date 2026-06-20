# Pro &amp; Enterprise features

Liminal is **open-core**. The Community Edition (CE) is free, fair-source, and fully
functional with no account. Paid tiers add **entitlement-gated** features delivered by the
proprietary Enterprise Edition (EE) package and the Vireon control plane.

This page is the authoritative reference for *what each tier adds*, *how each feature
works*, and *which environment keys and endpoints back it*. For the licensing model and the
open-core boundary see [License](./license.md) and [Enterprise Edition](./enterprise-edition.md).
For day-to-day setup see the guides [Accounts &amp; licensing](../guides/accounts-and-licensing.md)
and [Managed inference](../guides/managed-inference.md).

> **CE never degrades.** Everything in [Configuration](../configuration.md) — the ReAct loop,
> 500+ tools in the family catalog (300+ with MCP sidecars), memory, vault, persona, both UIs — works with no license. Paid tiers only *add*
> cloud and team capabilities; they never paywall a local capability.

## Tiers at a glance

| Capability | Community | Pro | Team | Enterprise |
| ---------- | :-------: | :-: | :--: | :--------: |
| Full local harness (500+ catalog tools, both UIs, memory, vault, persona) | ✅ | ✅ | ✅ | ✅ |
| Bring-your-own-key inference (any OpenAI-compatible model) | ✅ | ✅ | ✅ | ✅ |
| **Managed inference** (no key, metered credits) | — | ✅ | ✅ | ✅ |
| **Cloud memory sync** (notes + vault across machines) | — | ✅ | ✅ | ✅ |
| **Cloud session history** (searchable, control-plane stored) | — | ✅ | ✅ | ✅ |
| **Shared memory bus** (per workspace/org) | — | — | ✅ | ✅ |
| **Audit log** (session events → control plane) | — | — | ✅ | ✅ |
| **RBAC** (org roles) | — | — | ✅ | ✅ |
| **Fleet config** (org-managed settings) | — | — | ✅ | ✅ |
| **Policy governance** (tool/approval policy) | — | — | ✅ | ✅ |
| **SSO / SAML / SCIM** | — | — | — | ✅ |
| **Self-hosted control plane** | — | — | — | ✅ |

Tiers are cumulative: each tier includes everything below it. Pricing lives on
[vireondynamics.com/liminal/pricing](https://www.vireondynamics.com/liminal/pricing).

## Entitlements

Features gate on **entitlement keys**, not on the tier name directly. A license token
carries a `tier` (which expands to that tier's entitlement set) plus any explicit `ent`
extras. The harness checks `hasEntitlement(resolved, KEY)` before activating a paid path.

| Entitlement key | Tier | Gates |
| --------------- | ---- | ----- |
| `pro.managed_inference` | Pro+ | Routing chat/sidecars through Vireon-managed inference |
| `pro.cloud_sync` | Pro+ | Cloud sync of typed notes + vault |
| `pro.session_history` | Pro+ | Cloud-stored, searchable session history |
| `team.shared_memory` | Team+ | Hosted shared-memory bus keyed by workspace/org |
| `team.audit_log` | Team+ | Shipping session events to the audit log |
| `team.rbac` | Team+ | Org role-based access control |
| `team.fleet_config` | Team+ | Org-managed centralized settings |
| `team.policy_governance` | Team+ | Org tool/approval policy enforcement |
| `enterprise.sso` | Enterprise | SSO / SAML / SCIM |
| `enterprise.self_host` | Enterprise | Self-hosted control plane |

Entitlement keys are **append-only and forward-compatible** (`packages/core/src/entitlements.ts`),
so an older harness honoring an older token keeps working.

## Pro

### Managed inference

Run Liminal without your own provider key. On Pro, chat completions — and the embeddings,
vision, and voice sidecars — can route through Vireon's metered, OpenAI-compatible proxy
instead of `AGENT_API_KEY`.

- **Gate:** `pro.managed_inference`.
- **Mode:** `AGENT_INFERENCE_MODE` = `auto` (default) routes managed when entitled;
  `managed` forces it; `byok` always uses your own key. With `auto`,
  `AGENT_INFERENCE_PREFER_MANAGED=1` (default) prefers managed even if a local key exists.
- **Session:** the harness exchanges your license for a short-lived session JWT at
  `AGENT_INFERENCE_SESSION_URL`, then calls `AGENT_INFERENCE_BASE_URL`.
- **Credits:** included monthly credits at pass-through rates, with optional top-ups. A
  budget-exceeded response (HTTP 402) surfaces a top-up hint.
- **Key source:** managed requests report `keySource: "VIREON_MANAGED"`.

Full walkthrough: [Managed inference](../guides/managed-inference.md).

### Cloud memory sync

Typed notes (`.agent_notes.json`) and your vault sync to the control plane so the agent's
memory is the same on every machine you sign in from.

- **Gate:** `pro.cloud_sync`.
- **Behavior:** with `AGENT_CLOUD_SYNC_AUTO=1` (EE default) the harness pushes notes each
  turn. Endpoints: `POST/GET /api/pro/cloud_sync/notes` and `/api/pro/cloud_sync/vault`.
- **Privacy:** sync is opt-in to Pro and disabled entirely in CE. Your code is never
  uploaded — only memory you chose to persist.

### Cloud session history

Session traces become searchable and durable beyond the local `.agent_sessions/` JSONL.

- **Gate:** `pro.session_history`.
- **Behavior:** with `AGENT_SESSION_HISTORY_CLOUD=1` (EE default) sessions upload each turn
  to `POST /api/pro/session_history`.

## Team

Team builds the org layer on top of Pro. All Team features are EE-delivered and
control-plane backed.

- **Shared memory bus** (`team.shared_memory`) — a hosted memory bus keyed by
  `workspaceFingerprint`/org, so teammates build on each other's facts and decisions instead
  of re-discovering them. Complements the local per-session `SharedMemoryBus`.
- **Audit log** (`team.audit_log`) — harness session events ship to a control-plane audit
  log for compliance and review.
- **RBAC** (`team.rbac`) — org roles control who can administer billing, fleet config, and
  policy.
- **Fleet config** (`team.fleet_config`) — push centralized harness settings (the same
  managed keys described in [Configuration](../configuration.md)) across the org.
- **Policy governance** (`team.policy_governance`) — org-level tool and approval policy so
  destructive tools or specific families can be constrained centrally.

## Enterprise

- **SSO / SAML / SCIM** (`enterprise.sso`) — identity-provider sign-in and user
  provisioning.
- **Self-hosted control plane** (`enterprise.self_host`) — run the billing/entitlement
  control plane in your own infrastructure. Point the harness at it with
  `AGENT_VIREON_SITE_URL` and `AGENT_INFERENCE_*`, and verify against your own signing key
  via `AGENT_LICENSE_PUBLIC_KEY`. See [Self-hosting](#self-hosted-control-plane-enterprise).

## How entitlements are verified

Licenses are compact tokens — `<payloadB64url>.<sigB64url>` — signed by the control plane
with an **Ed25519** private key. The harness holds only the **public** key, so it can verify
but never mint a license.

1. On startup the harness resolves a token: `~/.liminal/license.json` (written by sign-in),
   or `AGENT_LICENSE_KEY` (CI/headless). `AGENT_LICENSE_PREFER_ENV=1` makes the env key win.
2. The signature is verified against `AGENT_LICENSE_PUBLIC_KEY` (or the built-in production
   key). Bad signature → treated as Community.
3. Expiry is checked. Past `exp` but within the **offline grace window**
   (`AGENT_LICENSE_GRACE_DAYS`, default 14) → still honored, so a brief control-plane outage
   never locks out a paying user. Past grace → downgrades cleanly to Community.

This is why **key custody, not code secrecy, is the security boundary**: the
verifier (`entitlements.ts`) ships in the open CE source on purpose; only the control plane
holds the private signing key.

## Where things live on disk

| Path | Purpose | Mode |
| ---- | ------- | ---- |
| `~/.liminal/license.json` | Cached verified license token (offline grace) | `0600` |
| `~/.liminal/account.json` | Signed-in account (email, tier, source) | `0600` |
| `~/.liminal/enterprise/` | Installed Enterprise Edition package | — |

## Environment reference

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `AGENT_LICENSE_KEY` | — (secret) | License token for CI/headless; normally written by sign-in |
| `AGENT_LICENSE_PUBLIC_KEY` | built-in | Override verify key (self-hosted/enterprise control plane) |
| `AGENT_LICENSE_PREFER_ENV` | `0` | `1` = `AGENT_LICENSE_KEY` overrides the on-disk cache |
| `AGENT_LICENSE_GRACE_DAYS` | `14` | Offline grace window past `exp` |
| `AGENT_INFERENCE_MODE` | `auto` | `byok` \| `managed` \| `auto` |
| `AGENT_INFERENCE_PREFER_MANAGED` | `1` | In `auto`, prefer managed even if a local key exists |
| `AGENT_INFERENCE_BASE_URL` | `https://api.vireondynamics.com/v1/inference` | Managed inference proxy root |
| `AGENT_INFERENCE_SESSION_URL` | `https://www.vireondynamics.com/api/inference/session` | Mints session JWTs |
| `AGENT_INFERENCE_SESSION_TOKEN` | — | Pinned session JWT for CI/headless |
| `AGENT_VIREON_SITE_URL` | `https://www.vireondynamics.com` | Origin for sign-in + EE bundle download |
| `AGENT_ENTERPRISE_DIR` | — | Override the installed EE package root |
| `AGENT_CLOUD_SYNC_AUTO` | `1` (EE) | Auto-push notes/vault each turn |
| `AGENT_SESSION_HISTORY_CLOUD` | `1` (EE) | Auto-upload sessions each turn |

## Control-plane API (operator reference)

Production billing runs **inside the private marketing site** (`vireondynamics-website` on Vercel) as Next.js API routes — not as a published Express package in `liminal-ai`. See `docs/BILLING.md` and `docs/SECURITY.md` in that repo. The public tree only has [`packages/control-plane/README.md`](../../packages/control-plane/README.md) (pointer).

| Method | Path | Auth | Purpose |
| ------ | ---- | ---- | ------- |
| `POST` | `/api/license/verify` | — | Verify a token, return tier + entitlements |
| `GET` | `/api/license/me` | Supabase JWT | Active license for the signed-in user |
| `POST` | `/api/billing/checkout` | Supabase JWT | Start Stripe Checkout for a tier |
| `POST` | `/api/billing/portal` | Supabase JWT | Stripe Customer Portal URL |
| `POST` | `/api/stripe/webhook` | Stripe signature | Subscription lifecycle → issue/revoke |
| `GET` | `/api/inference/session` | Bearer license | Mint a short-lived inference session JWT |
| `GET` | `/api/inference/status` | Bearer license | Wallet / entitlement / remaining credits |
| `GET` | `/api/enterprise/bundle` | Bearer license | Download the EE bundle (`.tar.gz`) |
| `GET`/`PUT` | `/api/pro/cloud_sync/notes`, `/api/pro/cloud_sync/vault` | Bearer license + `pro.cloud_sync` | User notes/vault sync |
| `POST` | `/api/pro/session_history` | Bearer license + `pro.session_history` | Session chunk upload |
| `GET`/`PUT` | `/api/team/memory/notes` | Bearer license + `team.shared_memory` | Org workspace notes |
| `GET` | `/api/team/memory/status` | Bearer license + `team.shared_memory` | Org sync status |
| `POST`/`GET` | `/api/team/bus/publish`, `/api/team/bus/subscribe` | Bearer license + `team.shared_memory` | Live bus (optional) |

## Self-hosted control plane (Enterprise)

With `enterprise.self_host`, run your own control plane and point the harness at it:

```bash
# Verify against your control plane's signing key
AGENT_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
# Origin for sign-in + EE bundle download
AGENT_VIREON_SITE_URL=https://control-plane.your-org.com
# Managed inference proxy + session endpoint
AGENT_INFERENCE_BASE_URL=https://control-plane.your-org.com/v1/inference
AGENT_INFERENCE_SESSION_URL=https://control-plane.your-org.com/api/inference/session
```

The control plane mints the same Ed25519 token format the harness verifies, so the only
trust anchor you manage is the keypair.

## FAQ

**Do I need a Vireon account to use Liminal?**
No. Community Edition needs no account and no credit card. Accounts are only for Pro/Team
features (license keys, billing, managed inference, cloud sync).

**Is my code uploaded on Pro/Team?**
No. The agent runs locally. Cloud sync uploads only memory you persist (notes/vault); managed
inference proxies only the model request. Your repository and shell stay on your machine.

**What happens if my subscription lapses?**
The license stays valid through the offline grace window, then the harness downgrades cleanly
to Community — no lockout, no data loss; local memory and tools keep working.

**Can I mix managed inference and my own key?**
Yes. Set `AGENT_INFERENCE_MODE=byok` to always use your own key, or `auto` to prefer managed
when entitled. Switch anytime in the web Settings.
