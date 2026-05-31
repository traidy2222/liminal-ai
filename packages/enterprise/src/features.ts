/**
 * Liminal Enterprise Edition (EE) — feature manifest.
 *
 * PROPRIETARY. Licensed under ../LICENSE-EE. Not FSL, not open source.
 *
 * Each EE feature maps to an `ENTITLEMENTS.*` key (defined in `@liminal/core`).
 * `registerEnterpriseFeatures` (see ./enterprise_registration.ts) only activates
 * a feature when the resolved license grants its entitlement. Implementations
 * land incrementally — `cloud_sync` first — but the gate + manifest are real now,
 * so the CE/EE boundary is enforced before any EE code ships.
 */
import { ENTITLEMENTS, type EntitlementKey } from "@liminal/core";

export interface EnterpriseFeatureSpec {
  /** Stable feature id. */
  id: string;
  /** Human-readable description (shown in admin / Settings). */
  description: string;
  /** Entitlement required to activate this feature. */
  entitlement: EntitlementKey;
  /**
   * Optional tool-family id this feature contributes. When set, the host's
   * `onFeature` callback should activate this family in the live registry AND
   * the family should be registered in `core` `ENTITLEMENT_GATED_FAMILIES` so
   * lazy activation can't bypass the gate.
   */
  family?: string;
  /** Lowest tier that grants this feature (informational, for pricing copy). */
  tier: "pro" | "team" | "enterprise";
}

/** The EE feature roadmap. Append-only so issued licenses stay forward-compatible. */
export const ENTERPRISE_FEATURES: readonly EnterpriseFeatureSpec[] = [
  {
    id: "cloud_sync",
    description: "Sync typed memory + vault across machines via the control plane.",
    entitlement: ENTITLEMENTS.PRO_CLOUD_SYNC,
    family: "cloud_sync",
    tier: "pro",
  },
  {
    id: "session_history",
    description: "Cloud-stored, searchable session history.",
    entitlement: ENTITLEMENTS.PRO_SESSION_HISTORY,
    tier: "pro",
  },
  {
    id: "managed_inference",
    description: "Optional Vireon-managed inference key (metered).",
    entitlement: ENTITLEMENTS.PRO_MANAGED_INFERENCE,
    tier: "pro",
  },
  {
    id: "team_shared_memory",
    description: "Hosted, multi-tenant shared memory bus keyed by workspace/org.",
    entitlement: ENTITLEMENTS.TEAM_SHARED_MEMORY,
    family: "team_memory",
    tier: "team",
  },
  {
    id: "audit_log",
    description: "Ship session events to the control-plane audit log.",
    entitlement: ENTITLEMENTS.TEAM_AUDIT_LOG,
    tier: "team",
  },
  {
    id: "rbac",
    description: "Org-level role-based access control.",
    entitlement: ENTITLEMENTS.TEAM_RBAC,
    tier: "team",
  },
  {
    id: "fleet_config",
    description: "Org-managed centralized settings / fleet config.",
    entitlement: ENTITLEMENTS.TEAM_FLEET_CONFIG,
    tier: "team",
  },
  {
    id: "policy_governance",
    description: "Org-level tool/approval policy governance.",
    entitlement: ENTITLEMENTS.TEAM_POLICY_GOVERNANCE,
    tier: "team",
  },
  {
    id: "sso",
    description: "SSO / SAML / SCIM.",
    entitlement: ENTITLEMENTS.ENT_SSO,
    tier: "enterprise",
  },
  {
    id: "self_host",
    description: "Self-hosted control plane.",
    entitlement: ENTITLEMENTS.ENT_SELF_HOST,
    tier: "enterprise",
  },
];
