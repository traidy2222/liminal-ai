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

  router.get("/api/pro/session_history", requireSessionHistory, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const sessionId =
        typeof req.query.sessionId === "string" ? req.query.sessionId.trim() : "";
      if (sessionId) {
        const { data, error } = await db
          .from("user_session_history")
          .select("session_id, chunk_index, payload, created_at")
          .eq("user_id", req.licenseUserId)
          .eq("session_id", sessionId)
          .order("chunk_index", { ascending: true });
        if (error) throw new Error(error.message);
        const chunks = data ?? [];
        if (chunks.length === 0) {
          res.status(404).json({ error: "session not found" });
          return;
        }
        const last = chunks[chunks.length - 1];
        const payload = (last.payload as Record<string, unknown>) ?? {};
        res.json({
          ok: true,
          session: {
            session_id: sessionId,
            title: typeof payload.title === "string" ? payload.title : null,
            summary: typeof payload.summary === "string" ? payload.summary : null,
            payload,
            event_count: typeof payload.eventCount === "number" ? payload.eventCount : chunks.length,
            updated_at: last.created_at,
          },
        });
        return;
      }

      const q = typeof req.query.q === "string" ? req.query.q.trim().toLowerCase() : "";
      const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? "20"), 10) || 20));
      const { data, error } = await db
        .from("user_session_history")
        .select("session_id, payload, created_at")
        .eq("user_id", req.licenseUserId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw new Error(error.message);
      const bySession = new Map<
        string,
        { session_id: string; title?: string; summary?: string; event_count?: number; updated_at?: string }
      >();
      for (const row of data ?? []) {
        const sid = row.session_id as string;
        if (bySession.has(sid)) continue;
        const payload = (row.payload as Record<string, unknown>) ?? {};
        const title = typeof payload.title === "string" ? payload.title : undefined;
        const summary = typeof payload.summary === "string" ? payload.summary : undefined;
        if (q) {
          const hay = `${title ?? ""} ${summary ?? ""} ${sid}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        bySession.set(sid, {
          session_id: sid,
          title,
          summary,
          event_count: typeof payload.eventCount === "number" ? payload.eventCount : undefined,
          updated_at: row.created_at as string,
        });
        if (bySession.size >= limit) break;
      }
      res.json({ ok: true, sessions: [...bySession.values()] });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/api/pro/session_history", requireSessionHistory, async (req: LicenseAuthedRequest, res: Response) => {
    try {
      if (!(await attachLicenseUserId(db, req)) || !req.licenseUserId) {
        res.status(403).json({ error: "license user not found" });
        return;
      }
      const body = req.body as {
        sessionId?: string;
        chatId?: string;
        title?: string;
        summary?: string;
        workspaceFingerprint?: string;
        eventCount?: number;
        chunkIndex?: number;
        payload?: Record<string, unknown>;
      };
      const sessionId = typeof body.sessionId === "string" ? body.sessionId.trim() : "";
      if (!sessionId) {
        res.status(400).json({ error: "sessionId required" });
        return;
      }
      const payload: Record<string, unknown> = {
        ...(body.payload ?? {}),
        ...(body.title ? { title: body.title } : {}),
        ...(body.summary ? { summary: body.summary } : {}),
        ...(body.chatId ? { chatId: body.chatId } : {}),
        ...(body.workspaceFingerprint ? { workspaceFingerprint: body.workspaceFingerprint } : {}),
        ...(body.eventCount != null ? { eventCount: body.eventCount } : {}),
      };
      const { error } = await db.from("user_session_history").insert({
        user_id: req.licenseUserId,
        session_id: sessionId,
        chunk_index: Number(body.chunkIndex ?? 0),
        payload,
      });
      if (error) throw new Error(error.message);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
