import { Router, type Response } from "express";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AuthedRequest } from "./auth.js";
import { OrgAuthError, addOrgMember, requireOrgRole, type OrgRole } from "./org_auth.js";

export function createTeamOrgRoutes(deps: {
  db: SupabaseClient;
  requireAuth: (req: AuthedRequest, res: Response, next: () => void) => void;
}): Router {
  const router = Router();
  const { db, requireAuth } = deps;

  router.post("/api/team/invites", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const orgId = typeof req.body?.orgId === "string" ? req.body.orgId.trim() : "";
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      const role = (typeof req.body?.role === "string" ? req.body.role : "member") as
        | "admin"
        | "member"
        | "viewer";
      if (!orgId || !email) {
        res.status(400).json({ error: "orgId and email required" });
        return;
      }
      await requireOrgRole(db, orgId, req.userId!, "admin");
      const token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
      const { error } = await db.from("org_invites").insert({
        org_id: orgId,
        email,
        role: role === "admin" ? "admin" : role === "viewer" ? "viewer" : "member",
        token,
        expires_at: expiresAt,
      });
      if (error) throw new Error(error.message);
      res.json({ ok: true, token, acceptPath: `/api/team/invites/accept` });
    } catch (err) {
      if (err instanceof OrgAuthError) {
        res.status(403).json({ error: "forbidden" });
        return;
      }
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/api/team/invites/accept", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
      if (!token) {
        res.status(400).json({ error: "token required" });
        return;
      }
      const { data: invite, error } = await db
        .from("org_invites")
        .select("org_id, email, role, accepted_by, expires_at")
        .eq("token", token)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!invite || invite.accepted_by) {
        res.status(404).json({ error: "invite not found or already used" });
        return;
      }
      const expiresMs = Date.parse(String(invite.expires_at ?? ""));
      if (Number.isFinite(expiresMs) && expiresMs < Date.now()) {
        res.status(410).json({ error: "invite expired" });
        return;
      }
      const userEmail = (req.userEmail ?? "").trim().toLowerCase();
      if (userEmail && invite.email !== userEmail) {
        res.status(403).json({ error: "invite email mismatch" });
        return;
      }
      const orgId = invite.org_id as string;
      const { count } = await db
        .from("org_members")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId);
      const { data: sub } = await db
        .from("subscriptions")
        .select("seats")
        .eq("org_id", orgId)
        .eq("status", "active")
        .maybeSingle();
      const seats = Number(sub?.seats ?? 99);
      if ((count ?? 0) >= seats) {
        res.status(409).json({ error: "org seat limit reached" });
        return;
      }
      await addOrgMember(db, orgId, req.userId!, invite.role as OrgRole);
      await db.from("org_invites").update({ accepted_by: req.userId! }).eq("token", token);
      res.json({ ok: true, orgId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
