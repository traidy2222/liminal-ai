import type { Request, Response, NextFunction } from "express";
import {
  hasEntitlement,
  resolveEntitlements,
  ENTITLEMENTS,
  type ResolvedEntitlements,
} from "@liminal/core";
import type { ControlPlaneConfig } from "./config.js";
import { getActiveLicenseForUser } from "./supabase_admin.js";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LicenseAuthedRequest extends Request {
  licenseToken?: string;
  licenseResolved?: ResolvedEntitlements;
  licenseUserId?: string;
}

export function createLicenseBearerMiddleware(
  config: ControlPlaneConfig,
  requiredEntitlement?: string
) {
  return async (req: LicenseAuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing Bearer license token" });
      return;
    }
    const token = header.slice("Bearer ".length).trim();
    const resolved = resolveEntitlements({ token, publicKeyPem: config.licensePublicKeyPem });
    if (resolved.status === "invalid" || resolved.status === "community") {
      res.status(403).json({ error: "invalid or community license" });
      return;
    }
    if (requiredEntitlement && !hasEntitlement(resolved, requiredEntitlement)) {
      res.status(403).json({ error: `missing entitlement: ${requiredEntitlement}` });
      return;
    }
    req.licenseToken = token;
    req.licenseResolved = resolved;
    next();
  };
}

/** Resolve license user id from token sub via licenses table. */
export async function resolveLicenseUserId(
  db: SupabaseClient,
  licenseSub: string
): Promise<string | null> {
  const { data, error } = await db
    .from("licenses")
    .select("user_id")
    .eq("license_sub", licenseSub)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) throw new Error(`license lookup: ${error.message}`);
  return data?.user_id ?? null;
}

export async function attachLicenseUserId(
  db: SupabaseClient,
  req: LicenseAuthedRequest
): Promise<boolean> {
  const sub = req.licenseResolved?.license?.sub;
  if (!sub) return false;
  const userId = await resolveLicenseUserId(db, sub);
  if (!userId) return false;
  req.licenseUserId = userId;
  return true;
}

export async function resolveLicenseUserFromToken(
  db: SupabaseClient,
  token: string,
  publicKeyPem?: string
): Promise<{ userId: string; resolved: ResolvedEntitlements } | null> {
  const resolved = resolveEntitlements({ token, publicKeyPem });
  const sub = resolved.license?.sub;
  if (!sub) return null;
  const userId = await resolveLicenseUserId(db, sub);
  if (!userId) return null;
  return { userId, resolved };
}

export { ENTITLEMENTS, getActiveLicenseForUser };
