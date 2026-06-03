import { Router, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig } from "./config.js";
import {
  ENTITLEMENTS,
  createLicenseBearerMiddleware,
  attachLicenseUserId,
  type LicenseAuthedRequest,
} from "./license_auth.js";
import { OrgAuthError, requireOrgRole, getOrgMemberRole } from "./org_auth.js";
import {
  assertLicenseOrgMatch,
  assertTeamSyncablePayload,
  isTeamSyncableScope,
  notePayloadScope,
  TeamMemoryPolicyError,
} from "./team_memory_helpers.js";

export function createTeamRoutes(deps: { config: ControlPlaneConfig; db: SupabaseClient }): Router {
  const router = Router();
  const { config, db } = deps;
  const requireTeamMemory = createLicenseBearerMiddleware(config, ENTITLEMENTS.TEAM_SHARED_MEMORY);

  router.get("/api/team/memory/notes", requireTeamMemory, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const orgId =
        (typeof req.query.org_id === "string" ? req.query.org_id : "") ||
        req.licenseResolved?.license?.org?.trim() ||
        "";
      const ws =
        typeof req.query.workspace_fingerprint === "string" ? req.query.workspace_fingerprint : "";
      if (!orgId || !ws) {
        res.status(400).json({ error: "org_id and workspace_fingerprint required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "viewer");
      const since = Number(req.query.since_revision ?? 0) || 0;
      const { data, error } = await db
        .from("org_memory_notes")
        .select("note_key, revision, payload, updated_at, deleted_at")
        .eq("org_id", orgId)
        .eq("workspace_fingerprint", ws);
      if (error) throw new Error(error.message);
      const notes: Record<string, unknown> = {};
      let maxRev = 0;
      for (const row of data ?? []) {
        if (row.deleted_at) continue;
        const scope = notePayloadScope(row.payload);
        if (!isTeamSyncableScope(scope)) continue;
        const rev = Number(row.revision ?? 0);
        if (rev <= since) continue;
        maxRev = Math.max(maxRev, rev);
        notes[row.note_key as string] = row.payload;
      }
      const { count } = await db
        .from("org_members")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId);
      res.json({
        orgId,
        workspaceFingerprint: ws,
        revision: maxRev,
        notes,
        memberCount: count ?? 0,
      });
    } catch (err) {
      if (err instanceof OrgAuthError || err instanceof TeamMemoryPolicyError) {
        res.status(403).json({ error: err instanceof Error ? err.message : "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/api/team/memory/notes", requireTeamMemory, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        orgId?: string;
        workspaceFingerprint?: string;
        revision?: number;
        notes?: Record<string, Record<string, unknown>>;
        tombstones?: string[];
      };
      const orgId = body.orgId?.trim() || req.licenseResolved?.license?.org?.trim() || "";
      const ws = body.workspaceFingerprint?.trim() ?? "";
      if (!orgId || !ws) {
        res.status(400).json({ error: "orgId and workspaceFingerprint required" });
        return;
      }
      assertLicenseOrgMatch(req, orgId);
      await requireOrgRole(db, orgId, req.licenseUserId, "member");
      const rows = Object.entries(body.notes ?? {});
      for (const [noteKey, payload] of rows) {
        assertTeamSyncablePayload(payload, noteKey);
        const { error } = await db.from("org_memory_notes").upsert(
          {
            org_id: orgId,
            workspace_fingerprint: ws,
            note_key: noteKey,
            revision: Number((payload as { revision?: number }).revision ?? Date.now()),
            payload,
            updated_by: req.licenseUserId,
            updated_at: new Date().toISOString(),
            deleted_at: null,
          },
          { onConflict: "org_id,workspace_fingerprint,note_key" }
        );
        if (error) throw new Error(error.message);
      }
      for (const key of body.tombstones ?? []) {
        await db
          .from("org_memory_notes")
          .update({ deleted_at: new Date().toISOString() })
          .eq("org_id", orgId)
          .eq("workspace_fingerprint", ws)
          .eq("note_key", key);
      }
      res.json({ ok: true, revision: Number(body.revision ?? 0) + 1 });
    } catch (err) {
      if (err instanceof TeamMemoryPolicyError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/team/memory/status", requireTeamMemory, async (req: LicenseAuthedRequest, res: Response) => {
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
      const role = await getOrgMemberRole(db, orgId, req.licenseUserId);
      if (!role) {
        res.status(403).json({ error: "not a member" });
        return;
      }
      const { count } = await db
        .from("org_members")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId);
      res.json({ orgId, role, memberCount: count ?? 0, sync: "ready" });
    } catch (err) {
      if (err instanceof TeamMemoryPolicyError) {
        res.status(403).json({ error: err.message });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/team/memory/index/meta", requireTeamMemory, (_req, res) => {
    res.json({ serverSideEmbed: false, revision: 0 });
  });

  return router;
}
