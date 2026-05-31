import { randomUUID } from "node:crypto";
import {
  signLicenseToken,
  verifyLicenseToken,
  resolveEntitlements,
  entitlementsForTier,
  type LicensePayload,
  type LicenseTier,
  type ResolvedEntitlements,
} from "@liminal/core";
import type { PaidTier, ControlPlaneConfig } from "./config.js";

export interface IssueLicenseInput {
  userId: string;
  tier: PaidTier;
  /** Epoch seconds; defaults to now + licenseTermDays from config. */
  expSec?: number;
  seats?: number;
  orgId?: string;
  /** Re-use stable sub when re-issuing for the same license row. */
  licenseSub?: string;
}

export function newLicenseSub(): string {
  return `lic_${randomUUID().replace(/-/g, "")}`;
}

export function buildLicensePayload(
  input: IssueLicenseInput,
  config: ControlPlaneConfig,
  nowSec = Math.floor(Date.now() / 1000)
): LicensePayload {
  const exp =
    input.expSec ??
    nowSec + config.licenseTermDays * 86_400;
  return {
    v: 1,
    sub: input.licenseSub ?? newLicenseSub(),
    tier: input.tier,
    iat: nowSec,
    exp,
    iss: "vireon",
    seats: input.seats ?? 1,
    ...(input.orgId ? { org: input.orgId } : {}),
  };
}

export function mintLicenseToken(payload: LicensePayload, privateKeyPem: string): string {
  return signLicenseToken(payload, privateKeyPem);
}

export function verifyAndResolve(
  token: string,
  publicKeyPem: string,
  nowMs?: number
): { verified: ReturnType<typeof verifyLicenseToken>; resolved: ResolvedEntitlements } {
  const verified = verifyLicenseToken(token, publicKeyPem);
  const resolved = resolveEntitlements({
    token: verified.ok ? token : "",
    publicKeyPem,
    now: nowMs,
  });
  return { verified, resolved };
}

/** Public API shape for /api/license/verify */
export function licenseVerifyResponse(
  token: string,
  publicKeyPem: string,
  nowMs?: number
): {
  ok: boolean;
  tier: LicenseTier;
  status: string;
  entitlements: string[];
  expiresAt: number | null;
  licenseSub: string | null;
  reason: string;
} {
  const { verified, resolved } = verifyAndResolve(token, publicKeyPem, nowMs);
  return {
    ok: verified.ok && resolved.status !== "invalid" && resolved.status !== "expired",
    tier: resolved.tier,
    status: resolved.status,
    entitlements: [...resolved.entitlements],
    expiresAt: resolved.license?.exp ?? null,
    licenseSub: resolved.license?.sub ?? null,
    reason: resolved.reason,
  };
}

export function entitlementsListForTier(tier: LicenseTier): string[] {
  return entitlementsForTier(tier);
}

/** Stripe subscription status → whether we should issue/refresh a license. */
export function subscriptionGrantsLicense(status: string): boolean {
  const s = status.toLowerCase();
  return s === "active" || s === "trialing" || s === "past_due";
}

export function epochSecFromDate(d: Date | null | undefined, fallbackSec: number): number {
  if (!d || Number.isNaN(d.getTime())) return fallbackSec;
  return Math.floor(d.getTime() / 1000);
}
