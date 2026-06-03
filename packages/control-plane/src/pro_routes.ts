import { Router, type Response } from "express";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig } from "./config.js";
import { ENTITLEMENTS, createLicenseBearerMiddleware, attachLicenseUserId, type LicenseAuthedRequest } from "./license_auth.js";

export function createProRoutes(deps: { config: ControlPlaneConfig; db: SupabaseClient }): Router {
  const router = Router();
  const { config, db } = deps;
  const requireProSync = createLicenseBearerMiddleware(config, ENTITLEMENTS.PRO_CLOUD_SYNC);
  const requireSessionHistory = createLicenseBearerMiddleware(config, ENTITLEMENTS.PRO_SESSION_HISTORY);

  router.get("/api/pro/cloud_sync/notes", requireProSync, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const workspaceFingerprint =
        typeof req.query.workspaceFingerprint === "string" ? req.query.workspaceFingerprint : "";
      const { data, error } = await db
        .from("user_memory_notes")
        .select("revision, payload, updated_at")
        .eq("user_id", req.licenseUserId)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const revision = Number(data?.revision ?? 0);
      const notes = (data?.payload as Record<string, unknown>) ?? {};
      res.json({
        ok: true,
        workspaceFingerprint,
        revision,
        notes,
        updatedAt: data?.updated_at ?? null,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.put("/api/pro/cloud_sync/notes", requireProSync, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        workspaceFingerprint?: string;
        revision?: number;
        notes?: Record<string, unknown>;
        force?: boolean;
      };
      const clientRevision = Number(body.revision ?? 0);
      const { data: existing } = await db
        .from("user_memory_notes")
        .select("revision, payload")
        .eq("user_id", req.licenseUserId)
        .maybeSingle();
      const serverRevision = Number(existing?.revision ?? 0);
      if (!body.force && clientRevision > 0 && clientRevision < serverRevision) {
        res.status(409).json({
          error: "Revision conflict",
          workspaceFingerprint: body.workspaceFingerprint ?? "",
          revision: serverRevision,
          notes: existing?.payload ?? {},
        });
        return;
      }
      const merged = { ...((existing?.payload as Record<string, unknown>) ?? {}), ...(body.notes ?? {}) };
      const nextRevision = Math.max(serverRevision, clientRevision) + 1;
      const byteSize = JSON.stringify(merged).length;
      const { error } = await db.from("user_memory_notes").upsert({
        user_id: req.licenseUserId,
        revision: nextRevision,
        payload: merged,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      res.json({
        ok: true,
        workspaceFingerprint: body.workspaceFingerprint ?? "",
        revision: nextRevision,
        updatedAt: new Date().toISOString(),
        byteSize,
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get("/api/pro/cloud_sync/vault", requireProSync, (_req, res) => {
    res.json({ ok: true, files: [] });
  });

  router.put("/api/pro/cloud_sync/vault", requireProSync, (_req, res) => {
    res.json({ ok: true });
  });

  router.post("/api/pro/session_history", requireSessionHistory, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as { sessionId?: string; chunkIndex?: number; payload?: Record<string, unknown> };
      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      if (!sessionId) {
        res.status(400).json({ error: "sessionId required" });
        return;
      }
      const { error } = await db.from("user_session_history").insert({
        user_id: req.licenseUserId,
        session_id: sessionId,
        chunk_index: Number(body.chunkIndex ?? 0),
        payload: body.payload ?? {},
      });
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
