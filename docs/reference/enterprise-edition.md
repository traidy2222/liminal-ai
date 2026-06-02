# Enterprise Edition (out of repo)

The proprietary `@liminal/enterprise` package is **not** in the public FSL repository. Pro+ users receive it automatically after `liminal login`.

## How it works

1. **Community Edition** (`core`, `tools`, `web`, `tui`) is fully functional without EE.
2. **License verification** lives in `packages/core/src/entitlements.ts` (public, by design).
3. **EE implementations** install to `~/.liminal/enterprise/` or load from `AGENT_ENTERPRISE_DIR`.
4. **`wireEnterpriseWithInstall()`** (called from web/TUI startup) installs EE when missing, then registers Pro+ tools.

## Resolution order

1. `AGENT_ENTERPRISE_DIR` — absolute path to a built EE package
2. `~/.liminal/enterprise/` — installed by login or auto-install on wire
3. `packages/enterprise/` — local dev checkout (gitignored)
4. `@liminal/enterprise` npm workspace link (monorepo dev only)

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

Server env: `VIREON_ENTERPRISE_BUNDLE_PATH` pointing to the packed tarball (see `scripts/pack-enterprise-bundle.mjs`).

## Removing EE from git history

If `packages/enterprise/` was previously tracked:

```bash
git rm -r --cached packages/enterprise
git commit -m "Stop tracking proprietary enterprise package"
```

Local EE checkouts remain on disk; `.gitignore` prevents re-adding them.
