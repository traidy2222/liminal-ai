# Enterprise Edition (out of repo)

The proprietary `@liminal/enterprise` package holds the implementations of the paid,
entitlement-gated features (managed inference glue, cloud sync, session history, team shared
memory, audit, RBAC, fleet config, policy governance, SSO, self-host). It is **not** in the
public FSL repository — Pro+ users receive it automatically after `liminal login`.

For *what* the paid features do, see [Pro &amp; Enterprise](./pro-and-enterprise.md). This page
is about *how the EE package is delivered, loaded, and isolated* from Community Edition.

## The open-core boundary

| | Community Edition (CE) | Enterprise Edition (EE) |
| --- | --- | --- |
| Packages | `core`, `tools`, `tui`, `web` | `@liminal/enterprise` (separate) |
| In public git? | Yes (FSL-1.1-MIT) | No |
| License | Fair-source, converts to MIT after 2 years | Commercial, never converts |
| Required to run Liminal? | — (it *is* Liminal) | No — CE is fully functional alone |

CE is the whole agent. EE only *adds* paid surfaces, and it activates a feature only when the
matching **entitlement** is present. The entitlement **verifier** lives in CE
(`packages/core/src/entitlements.ts`) on purpose — see
[security model](#security-model) below.

## Team memory hooks (CE contract)

`AgentHarness` exposes optional callbacks wired by EE when `team.shared_memory` or
`pro.cloud_sync` is active:

- `onTurnStartMemorySync` — pull cloud/org note deltas before ReAct round 0
- `onTurnEndMemorySync` — push dirty notes after `turn_end`
- `onRecallMerge` — optional remote candidate injection before auto-recall

EE may also register `createNotesFacade(ctx)` via `wireEnterpriseHarness` to wrap the local
`NotesFacade` ([`packages/core/src/notes_facade.ts`](../../packages/core/src/notes_facade.ts)).

## How it loads

1. **Community Edition** (`core`, `tools`, `web`, `tui`) is fully functional without EE.
2. **License verification** lives in `packages/core/src/entitlements.ts` (public, by design).
3. **EE implementations** install to `~/.liminal/enterprise/` or load from `AGENT_ENTERPRISE_DIR`.
4. **`wireEnterpriseWithInstall()`** (called from web/TUI startup) resolves the current
   entitlements, loads the EE module if present, and — for Pro+ tiers when EE is missing —
   downloads and installs it, then registers the Pro+ tools into the live registry. It never
   throws: if EE can't load, the harness keeps running as Community.

## Resolution order

The loader (`packages/core/src/enterprise_loader.ts`) tries these roots in order and uses the
first with a valid `dist/index.js`:

1. `AGENT_ENTERPRISE_DIR` — absolute path to a built EE package
2. `~/.liminal/enterprise/` — installed by login or auto-install on wire
3. `packages/enterprise/` — local dev checkout (gitignored)
4. `@liminal/enterprise` npm workspace link (monorepo dev only)

Host `@liminal/core` and `@liminal/tools` are symlinked into the EE package's `node_modules`
so the installed EE `dist` imports the *running* harness, not a divergent copy.

## Install &amp; integrity

`ensureEnterpriseEditionInstalled()` (`packages/core/src/enterprise_install.ts`) is invoked
after `liminal login` for Pro+ tiers, and on first wire when EE is missing:

1. `GET /api/enterprise/bundle` with the Bearer license token → `enterprise-bundle.tar.gz`,
   plus `x-enterprise-version` / `x-enterprise-sha256` / `x-enterprise-built-at` headers.
2. The download is **sha256-verified** against the header before use.
3. It extracts into a staging dir, atomically swaps into `~/.liminal/enterprise/`, links host
   deps, and writes `manifest.json`. Installs are **idempotent** — a matching version/sha is
   skipped.

## Environment

| Variable | Purpose |
| -------- | ------- |
| `AGENT_ENTERPRISE_DIR` | Override EE package root |
| `AGENT_VIREON_SITE_URL` | Control plane for bundle download (default `https://www.vireondynamics.com`) |
| `AGENT_CLOUD_SYNC_AUTO` | Auto-push notes each turn (default `1`) |
| `AGENT_SESSION_HISTORY_CLOUD` | Auto-upload sessions each turn (default `1`) |

## Control plane

- `GET /api/enterprise/bundle` — Bearer license token → `enterprise-bundle.tar.gz`
- Pro APIs: `/api/pro/cloud_sync/*`, `/api/pro/session_history`

Server env: `VIREON_ENTERPRISE_BUNDLE_PATH` pointing to the packed tarball (see
`scripts/pack-enterprise-bundle.mjs`). Full operator API:
[Pro &amp; Enterprise → Control-plane API](./pro-and-enterprise.md#control-plane-api-operator-reference).

## Security model

Safety comes from **key custody, not code secrecy**:

- The harness holds only the **public** Ed25519 key, so the open CE verifier can confirm a
  license but can never mint one. The **private** signing key lives only in the control plane.
- EE *feature code* is proprietary and shipped separately, but the gate that decides whether
  it runs is open and auditable.
- Downloaded bundles are checksum-verified before they're trusted.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| "Enterprise Edition not installed" | Run `liminal login` on a Pro+ account, or set `AGENT_ENTERPRISE_DIR` to a built EE package. |
| EE didn't auto-install after login | Re-run `liminal login`; check network access to `AGENT_VIREON_SITE_URL`; inspect `~/.liminal/enterprise/manifest.json`. |
| Checksum mismatch | Corrupt or interrupted download — delete `~/.liminal/enterprise/` and re-run login. |
| Pro features missing despite EE present | Confirm the license verifies and isn't past grace (see [Accounts &amp; licensing](../guides/accounts-and-licensing.md)). |

## Removing EE from git history

If `packages/enterprise/` was previously tracked:

```bash
git rm -r --cached packages/enterprise
git commit -m "Stop tracking proprietary enterprise package"
```

Local EE checkouts remain on disk; `.gitignore` prevents re-adding them.
