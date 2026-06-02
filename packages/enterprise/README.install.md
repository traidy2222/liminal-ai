# Enterprise Edition (proprietary)

This folder is **gitignored** in the public Community Edition repository.

Pro and Team features (`cloud_memory_sync`, session history, team tools) live in the proprietary
`@liminal/enterprise` package. Community Edition ships only the **loader** in `@liminal/core`
(`enterprise_loader.ts`, `enterprise_install.ts`).

## For Pro+ users (no local EE checkout)

```bash
liminal login
```

After sign-in, the harness downloads EE to `~/.liminal/enterprise/` from the Vireon control plane.

## For Vireon developers (local EE)

1. Clone or copy the proprietary EE sources into `packages/enterprise/` (this directory).
2. Build: `npm run build -w packages/core && npm run build -w packages/tools && npm run build -w packages/enterprise`
3. Optional: `node scripts/pack-enterprise-bundle.mjs` → upload `enterprise-bundle.tar.gz` to production.

Or set `AGENT_ENTERPRISE_DIR` to any built EE package root.

## Open-core boundary

| In public git (FSL) | Out of public git (LICENSE-EE) |
| ------------------- | ------------------------------ |
| `entitlements.ts` — verify licenses | `packages/enterprise/*` — feature implementations |
| `enterprise_loader.ts` — dynamic import | Cloud sync + session history tools |
| `enterprise_install.ts` — download on login | Future team/enterprise tool families |

See `docs/reference/license.md` and `docs/reference/enterprise-edition.md`.
