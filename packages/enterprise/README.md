# @liminal/enterprise — Liminal Enterprise Edition (EE)

> **Proprietary. Not open source. Not FSL.** This package is licensed under the
> commercial [`LICENSE-EE`](./LICENSE-EE) and is **never** subject to the
> FSL "MIT Future License" conversion that applies to the Community Edition.

This package holds Liminal's paid, **entitlement-gated** features — the layer that
makes the product billable. The open-core boundary is:

| Edition | Where | License | MIT conversion |
|---------|-------|---------|----------------|
| **Community (CE)** | `packages/core`, `packages/tools`, `packages/web`, `packages/tui` | FSL-1.1-MIT | Yes (2-year) |
| **Enterprise (EE)** | **this package** | Commercial (`LICENSE-EE`) | **Never** |

CE is fully functional on its own. EE features only activate when a valid license
**Entitlement** is present — see `packages/core/src/entitlements.ts` (the gate) and
the tiers in [`docs/reference/license.md`](../../docs/reference/license.md).

## What's here

- **`src/features.ts`** — `ENTERPRISE_FEATURES`: the manifest mapping each EE
  feature to the `ENTITLEMENTS.*` key it requires (from `@liminal/core`).
- **`src/enterprise_registration.ts`** — `registerEnterpriseFeatures(...)`: the
  entitlement-gated entry point. It registers only the features the current
  `ResolvedEntitlements` allow, and calls back into the host (`onFeature`) to wire
  each feature's tools — the **integration seam**.

## Integration boundary (important)

The CE packages (`core`/`tools`/`web`/`tui`) **do not import this package.** That
keeps the FSL build free of proprietary code and preserves the "no coupling"
invariant. A host that has procured EE (e.g. a commercial distribution, or the web
app behind a license check) calls `registerEnterpriseFeatures` and supplies an
`onFeature` callback that activates the corresponding tool family in the live
`ToolRegistry`. The first such feature — **cloud memory sync** — lands next.

This package may also be extracted to a private repository / registry; the
proprietary license, not its location, is what enforces the boundary.

## Build

```bash
npm run build -w packages/core        # EE depends on core's dist
npm run build -w packages/enterprise
npm run test  -w packages/enterprise
```
