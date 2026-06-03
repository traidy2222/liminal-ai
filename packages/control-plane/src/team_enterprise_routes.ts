import { Router, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig } from "./config.js";
import {
  ENTITLEMENTS,
  createLicenseBearerMiddleware,
  attachLicenseUserId,
  type LicenseAuthedRequest,
} from "./license_auth.js";
import { OrgAuthError, requireOrgRole } from "./org_auth.js";
import {
  listOrgMembersWithProfiles,
  listPendingInvites,
  OrgMemberError,
  queryAuditEvents,
  removeMember,
  revokeInvite,
  updateMemberRole,
} from "./org_members.js";
import { assertLicenseOrgMatch, TeamMemoryPolicyError } from "./team_memory_helpers.js";

export function createTeamEnterpriseRoutes(deps: {
  config: ControlPlaneConfig;
  db: SupabaseClient;
}): Router {
  const router = Router();
  const { config, db } = deps;

  const requireAudit = createLicenseBearerMiddleware(config, ENTITLEMENTS.TEAM_AUDIT_LOG);
  const requireFleet = createLicenseBearerMiddleware(config, ENTITLEMENTS.TEAM_FLEET_CONFIG);
  const requirePolicy = createLicenseBearerMiddleware(config, ENTITLEMENTS.TEAM_POLICY_GOVERNANCE);
  const requireRbac = createLicenseBearerMiddleware(config, ENTITLEMENTS.TEAM_RBAC);

  router.get("/api/team/audit/events", requireAudit, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      if (!orgId) {
        res.status(400).json({ error: "org_id required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      const limit = Number(req.query.limit ?? 50);
      const result = await queryAuditEvents(db, orgId, req.licenseUserId, limit);
      res.json({ ok: true, orgId, ...result, nextCursor: null });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/api/team/audit/events", requireAudit, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        orgId?: string;
        events?: Array<{
          eventType?: string;
          sessionId?: string;
          payload?: Record<string, unknown>;
        }>;
      };
      const orgId = body.orgId?.trim() || req.licenseResolved?.license?.org?.trim() || "";
      const events = Array.isArray(body.events) ? body.events : [];
      if (!orgId || events.length === 0) {
        res.status(400).json({ error: "orgId and events[] required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "member");
      const rows = events.slice(0, 50).map((e) => ({
        org_id: orgId,
        user_id: req.licenseUserId,
        session_id: typeof e.sessionId === "string" ? e.sessionId.slice(0, 128) : null,
        event_type: (typeof e.eventType === "string" ? e.eventType : "turn_end").slice(0, 64),
        payload: e.payload ?? {},
      }));
      const { error } = await db.from("org_audit_events").insert(rows);
      if (error) throw new Error(error.message);
      res.json({ ok: true, inserted: rows.length });
    } catch (err) {
      if (err instanceof TeamMemoryPolicyError) {
        res.status(403).json({ error: err.message });
        return;
      }
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/team/fleet/config", requireFleet, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      if (!orgId) {
        res.status(400).json({ error: "org_id required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "viewer");
      const { data, error } = await db
        .from("org_fleet_config")
        .select("revision, config, updated_at")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      res.json({
        ok: true,
        orgId,
        revision: Number(data?.revision ?? 0),
        config: (data?.config as Record<string, unknown>) ?? {},
        updatedAt: data?.updated_at ?? null,
      });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/api/team/fleet/config", requireFleet, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        orgId?: string;
        revision?: number;
        config?: Record<string, unknown>;
      };
      const orgId = body.orgId?.trim() || req.licenseResolved?.license?.org?.trim() || "";
      if (!orgId || !body.config) {
        res.status(400).json({ error: "orgId and config required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "admin");
      const clientRevision = Number(body.revision ?? 0);
      const { data: existing } = await db
        .from("org_fleet_config")
        .select("revision")
        .eq("org_id", orgId)
        .maybeSingle();
      const serverRevision = Number(existing?.revision ?? 0);
      if (clientRevision > 0 && clientRevision < serverRevision) {
        res.status(409).json({ error: "revision conflict", revision: serverRevision });
        return;
      }
      const nextRevision = Math.max(serverRevision, clientRevision) + 1;
      const { error } = await db.from("org_fleet_config").upsert({
        org_id: orgId,
        revision: nextRevision,
        config: body.config,
        updated_by: req.licenseUserId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      res.json({ ok: true, revision: nextRevision });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/team/policy", requirePolicy, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      if (!orgId) {
        res.status(400).json({ error: "org_id required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "viewer");
      const { data, error } = await db
        .from("org_policy")
        .select("revision, policy, updated_at")
        .eq("org_id", orgId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      res.json({
        ok: true,
        orgId,
        revision: Number(data?.revision ?? 0),
        policy: (data?.policy as Record<string, unknown>) ?? {},
        updatedAt: data?.updated_at ?? null,
      });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/api/team/policy", requirePolicy, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        orgId?: string;
        revision?: number;
        policy?: Record<string, unknown>;
      };
      const orgId = body.orgId?.trim() || req.licenseResolved?.license?.org?.trim() || "";
      if (!orgId || !body.policy) {
        res.status(400).json({ error: "orgId and policy required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "admin");
      const clientRevision = Number(body.revision ?? 0);
      const { data: existing } = await db
        .from("org_policy")
        .select("revision")
        .eq("org_id", orgId)
        .maybeSingle();
      const serverRevision = Number(existing?.revision ?? 0);
      if (clientRevision > 0 && clientRevision < serverRevision) {
        res.status(409).json({ error: "revision conflict", revision: serverRevision });
        return;
      }
      const nextRevision = Math.max(serverRevision, clientRevision) + 1;
      const { error } = await db.from("org_policy").upsert({
        org_id: orgId,
        revision: nextRevision,
        policy: body.policy,
        updated_by: req.licenseUserId,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      res.json({ ok: true, revision: nextRevision });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/team/org/members", requireRbac, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      if (!orgId) {
        res.status(400).json({ error: "org_id required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "viewer");
      const members = await listOrgMembersWithProfiles(db, orgId);
      res.json({ ok: true, orgId, members });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.patch("/api/team/org/members", requireRbac, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as { orgId?: string; userId?: string; role?: string };
      const orgId = body.orgId?.trim() || req.licenseResolved?.license?.org?.trim() || "";
      if (!orgId || !body.userId || !body.role) {
        res.status(400).json({ error: "orgId, userId, role required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await updateMemberRole(db, orgId, req.licenseUserId, body.userId, body.role as "admin" | "member" | "viewer");
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof OrgMemberError || err instanceof OrgAuthError) {
        res.status(403).json({ error: err instanceof Error ? err.message : "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/api/team/org/members", requireRbac, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      const userId = typeof req.query.userId === "string" ? req.query.userId : "";
      if (!orgId || !userId) {
        res.status(400).json({ error: "org_id and userId required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await removeMember(db, orgId, req.licenseUserId, userId);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof OrgMemberError || err instanceof OrgAuthError) {
        res.status(403).json({ error: err instanceof Error ? err.message : "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/team/invites", requireRbac, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      if (!orgId) {
        res.status(400).json({ error: "org_id required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      const invites = await listPendingInvites(db, orgId, req.licenseUserId);
      res.json({ ok: true, orgId, invites });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete("/api/team/invites", requireRbac, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      const token = typeof req.query.token === "string" ? req.query.token : "";
      if (!orgId || !token) {
        res.status(400).json({ error: "org_id and token required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await revokeInvite(db, orgId, req.licenseUserId, token);
      res.json({ ok: true });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/enterprise/sso/config", async (req: LicenseAuthedRequest, res: Response) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing Bearer license token" });
      return;
    }
    const { resolveEntitlements, hasEntitlement, ENTITLEMENTS: E } = await import("@liminal/core");
    const token = header.slice("Bearer ".length).trim();
    const resolved = resolveEntitlements({ token, publicKeyPem: config.licensePublicKeyPem });
    if (!hasEntitlement(resolved, E.ENT_SSO)) {
      res.status(403).json({ error: "missing entitlement: enterprise.sso" });
      return;
    }
    const issuer =
      process.env["VIREON_SSO_ISSUER_URL"]?.trim() ||
      process.env["AGENT_SSO_ISSUER_URL"]?.trim() ||
      "";
    res.json({
      ok: true,
      enabled: Boolean(issuer),
      issuerUrl: issuer || null,
      loginHint: issuer
        ? `Open ${issuer} to sign in with your organization SSO provider.`
        : "SSO issuer not configured on this control plane — set VIREON_SSO_ISSUER_URL.",
    });
  });

  router.get("/api/enterprise/self_host/status", async (req: LicenseAuthedRequest, res: Response) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing Bearer license token" });
      return;
    }
    const { resolveEntitlements, hasEntitlement, ENTITLEMENTS: E } = await import("@liminal/core");
    const token = header.slice("Bearer ".length).trim();
    const resolved = resolveEntitlements({ token, publicKeyPem: config.licensePublicKeyPem });
    if (!hasEntitlement(resolved, E.ENT_SELF_HOST)) {
      res.status(403).json({ error: "missing entitlement: enterprise.self_host" });
      return;
    }
    const cpUrl = process.env["VIREON_CONTROL_PLANE_PUBLIC_URL"]?.trim() || "";
    res.json({
      ok: true,
      controlPlaneUrl: cpUrl || null,
      hint: cpUrl
        ? `Point AGENT_CONTROL_PLANE_URL at ${cpUrl}`
        : "Self-hosted control plane URL not published — set VIREON_CONTROL_PLANE_PUBLIC_URL on the server.",
    });
  });

  router.get("/api/pro/managed_inference/status", async (req: LicenseAuthedRequest, res: Response) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing Bearer license token" });
      return;
    }
    const { resolveEntitlements, hasEntitlement, ENTITLEMENTS: E } = await import("@liminal/core");
    const token = header.slice("Bearer ".length).trim();
    const resolved = resolveEntitlements({ token, publicKeyPem: config.licensePublicKeyPem });
    if (!hasEntitlement(resolved, E.PRO_MANAGED_INFERENCE)) {
      res.status(403).json({ error: "missing entitlement: pro.managed_inference" });
      return;
    }
    const enabled = Boolean(process.env["VIREON_MANAGED_INFERENCE_ENABLED"]?.trim() === "1");
    res.json({
      ok: true,
      available: enabled,
      message: enabled
        ? "Managed inference is enabled for this deployment."
        : "Managed inference is not provisioned on this control plane yet.",
    });
  });

  return router;
}
