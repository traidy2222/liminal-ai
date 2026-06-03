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
import { assertLicenseOrgMatch, TeamMemoryPolicyError } from "./team_memory_helpers.js";

/** v1.1 — lightweight team bus via DB + SSE poll. */
export function createTeamBusRoutes(deps: { config: ControlPlaneConfig; db: SupabaseClient }): Router {
  const router = Router();
  const { config, db } = deps;
  const requireTeam = createLicenseBearerMiddleware(config, ENTITLEMENTS.TEAM_SHARED_MEMORY);

  router.post("/api/team/bus/publish", requireTeam, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        orgId?: string;
        workspaceFingerprint?: string;
        key?: string;
        envelope?: Record<string, unknown>;
      };
      const orgId = body.orgId?.trim() || req.licenseResolved?.license?.org?.trim() || "";
      const ws = body.workspaceFingerprint?.trim() ?? "";
      const key = body.key?.trim() ?? "";
      if (!orgId || !ws || !key || !body.envelope) {
        res.status(400).json({ error: "orgId, workspaceFingerprint, key, envelope required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "member");
      const { error } = await db.from("org_memory_bus").insert({
        org_id: orgId,
        workspace_fingerprint: ws,
        bus_key: key,
        envelope: body.envelope,
        publisher_id: req.licenseUserId,
      });
      if (error) throw new Error(error.message);
      res.json({ ok: true });
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

  router.get("/api/team/bus/subscribe", requireTeam, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      const ws = typeof req.query.workspace_fingerprint === "string" ? req.query.workspace_fingerprint : "";
      if (!orgId || !ws) {
        res.status(400).json({ error: "org_id and workspace_fingerprint required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "viewer");
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.flushHeaders?.();
      const since = new Date(Date.now() - 60_000).toISOString();
      const { data } = await db
        .from("org_memory_bus")
        .select("bus_key, envelope, created_at")
        .eq("org_id", orgId)
        .eq("workspace_fingerprint", ws)
        .gte("created_at", since)
        .order("created_at", { ascending: true })
        .limit(50);
      for (const row of data ?? []) {
        res.write(`data: ${JSON.stringify({ key: row.bus_key, envelope: row.envelope })}\n\n`);
      }
      res.write("data: {\"done\":true}\n\n");
      res.end();
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
