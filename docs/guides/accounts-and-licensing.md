# Accounts &amp; licensing

Community Edition needs **no account** — install and use every local feature with nothing
but an API key (or not even that, see managed inference). You only sign in to unlock **Pro,
Team, and Enterprise** features: managed inference, cloud sync, session history, and team
governance.

This guide covers signing in, where your license lives, how it's verified offline, and how to
run licensed features in CI. For the feature breakdown see
[Pro &amp; Enterprise](../reference/pro-and-enterprise.md); for the legal model see
[License](../reference/license.md).

## When do I need to sign in?

| You want… | Account needed? |
| --------- | --------------- |
| The full local agent, BYOK inference, memory, vault, persona | **No** |
| Managed inference (run without your own key) | Yes — Pro+ |
| Cloud memory sync / session history | Yes — Pro+ |
| Team shared memory, audit, RBAC, fleet config, policy | Yes — Team+ |
| SSO, self-hosted control plane | Yes — Enterprise |

## Sign in from the CLI

```bash
liminal login
```

This runs a **browser loopback flow**: the CLI opens
`https://www.vireondynamics.com/connect/harness` with a one-time `state` and a localhost
redirect, you sign in on the site, and the site posts a signed license token back to a
loopback port on `127.0.0.1`. The token is verified and cached locally. For Pro+ tiers, the
Enterprise Edition package is then downloaded and installed automatically (see
[Enterprise Edition](../reference/enterprise-edition.md)).

When you sign in on a Pro account, managed inference is enabled by default — see
[Managed inference](./managed-inference.md).

## Sign in from the web UI

In the web app: **Settings → Sign in to Vireon**. This uses the same loopback handshake
through the local server:

- `GET /api/vireon/connect/begin` → returns the connect URL + `state`
- `GET|POST /api/vireon/auth/callback` → receives and applies the token
- `GET /api/vireon/account` → current account, tier, entitlements
- `POST /api/vireon/logout` → clears the local license/account

## Where your license lives

| Path | Contents | Mode |
| ---- | -------- | ---- |
| `~/.liminal/license.json` | The verified license token (for offline grace) | `0600` |
| `~/.liminal/account.json` | Email, tier, and how you signed in | `0600` |
| `~/.liminal/enterprise/` | Installed Enterprise Edition package (Pro+) | — |

Nothing is written to `.env` — secrets stay out of your project. To remove the binding, run
logout from the web UI or delete those files.

## How verification works (offline-friendly)

Licenses are compact tokens signed by the control plane with an **Ed25519** key. The harness
holds only the **public** key, so it can verify a license but never create one.

1. **Resolve a token** — the on-disk cache (`~/.liminal/license.json`) is preferred; in CI you
   can supply `AGENT_LICENSE_KEY`. Set `AGENT_LICENSE_PREFER_ENV=1` to make the env value win.
2. **Verify the signature** against `AGENT_LICENSE_PUBLIC_KEY` (or the built-in production
   key). A bad signature downgrades to Community.
3. **Apply expiry with grace** — past `exp` but within `AGENT_LICENSE_GRACE_DAYS` (default
   **14**) the license is still honored, so a brief control-plane or network outage never
   locks out a paying user. Past grace, the harness downgrades cleanly to Community.

The whole verifier is open CE source (`packages/core/src/entitlements.ts`) on purpose:
**security comes from key custody** (only the control plane holds the private key), not from
hiding code.

## Tiers &amp; entitlements

`community` → `pro` → `team` → `enterprise`, each inheriting the tiers below it. A token
carries a `tier` plus optional explicit `ent` extras. Features check **entitlement keys**
(e.g. `pro.managed_inference`), not the tier name. Full table:
[Pro &amp; Enterprise → Entitlements](../reference/pro-and-enterprise.md#entitlements).

## CI / headless

No browser? Provide the token directly:

```bash
AGENT_LICENSE_KEY=<license-token>     # from Account → License on the site
AGENT_LICENSE_PREFER_ENV=1            # prefer env over any cached token
```

For managed inference in CI you can also pin a session token directly with
`AGENT_INFERENCE_SESSION_TOKEN` — see [Managed inference → Headless / CI](./managed-inference.md#headless-ci).

## Switching accounts / signing out

- **Web UI:** Settings → sign out (`POST /api/vireon/logout`), which clears
  `~/.liminal/license.json` and `account.json` and resets managed-inference session caches.
- **Manual:** delete those files in `~/.liminal/`.
- Re-run `liminal login` to bind a different account.

## Self-hosted / enterprise control plane

Enterprise customers running their own control plane point the harness at it and verify
against their own signing key:

```bash
AGENT_VIREON_SITE_URL=https://control-plane.your-org.com
AGENT_LICENSE_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----"
```

See [Pro &amp; Enterprise → Self-hosted control plane](../reference/pro-and-enterprise.md#self-hosted-control-plane-enterprise).

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| Sign-in browser never returns | Check that loopback `127.0.0.1` isn't blocked; re-run `liminal login` (5-minute timeout). |
| "License token is not valid" | Token didn't verify against the public key. Re-copy from Account → License, or check `AGENT_LICENSE_PUBLIC_KEY` for self-host. |
| Pro features off after a valid sign-in | Confirm tier at Account; ensure `~/.liminal/license.json` exists and isn't expired past grace. |
| CI ignores `AGENT_LICENSE_KEY` | Set `AGENT_LICENSE_PREFER_ENV=1` so the env token overrides any stale cache. |
