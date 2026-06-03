# License

Liminal is **open-core**: a fair-source Community Edition plus a proprietary Enterprise Edition.

The **Community Edition (CE)** is licensed under the **Functional Source License, Version 1.1, MIT Future License** ([FSL-1.1-MIT](https://fsl.software/)). The full text is in the repository root [`LICENSE`](https://github.com/traidy2222/liminal-ai/blob/main/LICENSE).

> **Not legal advice.** This page summarizes the LICENSE in plain language. If anything here conflicts with the LICENSE file, the LICENSE file controls.

## Editions: Community vs Enterprise (open-core)

| Edition | Packages | License | Future MIT? |
| ------- | -------- | ------- | ----------- |
| **Community (CE)** | `packages/core`, `packages/tools`, `packages/tui`, `packages/web` | FSL-1.1-MIT (fair-source) | Yes — each version after 2 years |
| **Enterprise (EE)** | Installed to `~/.liminal/enterprise/` (proprietary; not in public git) | Commercial ([`LICENSE-EE`](../../packages/enterprise/LICENSE-EE) when present locally) | **Never** |

The Community Edition is fully functional on its own. Enterprise Edition adds paid,
**entitlement-gated** features (cloud memory sync, team shared memory, audit log, RBAC,
SSO, self-host). EE code is proprietary, is **not** open/fair-source, and never converts to
MIT. EE features activate only when a valid license **entitlement** is present — verified
offline by `packages/core/src/entitlements.ts`, which signs/verifies Ed25519 license tokens
and falls back to the free Community tier whenever no valid license is found.

**Tiers:** Community (free) · Pro · Team · Enterprise. See the
[Pro &amp; Enterprise reference](./pro-and-enterprise.md) for the full per-tier feature
breakdown and entitlements, and [vireondynamics.com](https://vireondynamics.com) for current
pricing.

**Managed inference (Pro+):** entitlement `pro.managed_inference` lets the harness use
Vireon’s metered OpenAI-compatible proxy instead of a local `AGENT_API_KEY` when
`AGENT_INFERENCE_MODE` is `managed` or `auto` (default). BYOK is unchanged — Community and
Pro users can always supply their own OpenRouter key. See the
[Managed inference guide](../guides/managed-inference.md) and
[Pro &amp; Enterprise reference](./pro-and-enterprise.md).

**Billing backend:** private **vireondynamics-website** deployment (embedded Stripe + Supabase + `/api/license/*`).
The public repo only documents the stub at [`packages/control-plane/README.md`](../../packages/control-plane/README.md) — no billing source in `liminal-ai`.

**Enterprise package:** proprietary code is **not** in the public repository. See
[`enterprise-edition.md`](./enterprise-edition.md) for install paths and the open-core boundary.

## What FSL is (and is not)

- **Fair-source / source-available:** you can read, use, and modify the harness source under clear terms.
- **Not OSI open source:** competing commercial products built on this codebase are restricted until each version converts to MIT.
- **Not proprietary closed source:** the repository is public and the grant is broad for permitted purposes.

## Permitted (summary)

- **Internal use** — including commercial work inside your organization on your own machines.
- **Non-commercial education and research.**
- **Professional services** that help a licensee use Liminal under this license.
- Any purpose that is **not** a [Competing Use](https://fsl.software/) as defined in the LICENSE (substitute product/service, same or substantially similar functionality, etc.).

## Not permitted (summary)

- Offering a **commercial product or service** that substitutes for Liminal or has substantially similar functionality.
- **Redistributing** copies or derivatives without including the LICENSE and preserving copyright notices.
- **Using Vireon trademarks** beyond identifying origin and showing license details.

## Future MIT grant

Each **version** you receive gains an additional **MIT** license on the **second anniversary** of the date we first publish that version under these terms (typically a release tag on the public repository—not your install date).

## Patents and trademarks

- Permitted use includes a patent license from the licensor where necessary; asserting patent infringement against the Software terminates that license.
- Trademark use is limited as stated in the LICENSE.

## Third-party dependencies

npm dependencies remain under their own licenses. They do not change the FSL terms for Vireon’s Liminal source.

## Marketing summary

[vireondynamics.com/liminal/license](https://vireondynamics.com/liminal/license)

## Enterprise and competing use

For commercial launches that might be a Competing Use, or for an alternative license, contact Vireon Dynamics via the website before relying on this summary.
