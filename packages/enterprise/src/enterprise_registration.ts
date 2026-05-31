/**
 * Liminal Enterprise Edition (EE) — entitlement-gated registration entry point.
 *
 * PROPRIETARY. Licensed under ../LICENSE-EE. Not FSL, not open source.
 *
 * This is the single seam a host (a commercial distribution, or the web app behind
 * a license check) calls to turn on paid features. It depends only on `@liminal/core`
 * for the entitlement types — it does NOT import the CE tool registry — so the FSL
 * packages never depend on this proprietary package. The host supplies an `onFeature`
 * callback that wires each entitled feature's tools into the live registry.
 */
import { hasEntitlement, type ResolvedEntitlements } from "@liminal/core";
import { ENTERPRISE_FEATURES, type EnterpriseFeatureSpec } from "./features.js";

export interface EnterpriseRegistrationResult {
  /** Feature ids that were entitled and handed to `onFeature`. */
  registered: string[];
  /** Features that were skipped, with the entitlement they require. */
  skipped: { id: string; reason: string }[];
}

export interface RegisterEnterpriseOptions {
  /** Resolved license entitlements (from `core`'s `resolveEntitlements`/`loadResolvedEntitlements`). */
  entitlements: ResolvedEntitlements;
  /**
   * Wiring hook called once per entitled feature. The host activates the feature's
   * tool family / starts its service here. No-op-safe: omit it to dry-run the gate.
   */
  onFeature?: (feature: EnterpriseFeatureSpec) => void;
}

/** The EE features the given entitlements currently unlock. */
export function selectEntitledFeatures(entitlements: ResolvedEntitlements): EnterpriseFeatureSpec[] {
  return ENTERPRISE_FEATURES.filter((f) => hasEntitlement(entitlements, f.entitlement));
}

/**
 * Register every entitled EE feature, skipping the rest. Pure given its inputs except
 * for the host-provided `onFeature` side effect. Safe to call with community
 * entitlements — it simply registers nothing.
 */
export function registerEnterpriseFeatures(opts: RegisterEnterpriseOptions): EnterpriseRegistrationResult {
  const result: EnterpriseRegistrationResult = { registered: [], skipped: [] };
  for (const feature of ENTERPRISE_FEATURES) {
    if (hasEntitlement(opts.entitlements, feature.entitlement)) {
      opts.onFeature?.(feature);
      result.registered.push(feature.id);
    } else {
      result.skipped.push({ id: feature.id, reason: `requires ${feature.entitlement}` });
    }
  }
  return result;
}
