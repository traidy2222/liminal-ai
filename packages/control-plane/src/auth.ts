import type { Request, Response, NextFunction } from "express";
import { createClient } from "@supabase/supabase-js";
import type { ControlPlaneConfig } from "./config.js";

export interface AuthedRequest extends Request {
  userId?: string;
  userEmail?: string | null;
}

export function createAuthMiddleware(config: ControlPlaneConfig) {
  if (!config.supabaseAnonKey) {
    return (_req: Request, res: Response) => {
      res.status(503).json({ error: "SUPABASE_ANON_KEY not configured" });
    };
  }

  const authClient = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return async (req: AuthedRequest, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res.status(401).json({ error: "missing Bearer token" });
      return;
    }
    const jwt = header.slice("Bearer ".length).trim();
    try {
      const { data, error } = await authClient.auth.getUser(jwt);
      if (error || !data.user) {
        res.status(401).json({ error: "invalid session" });
        return;
      }
      req.userId = data.user.id;
      req.userEmail = data.user.email ?? null;
      next();
    } catch (err) {
      console.error("[control-plane] auth getUser failed", err);
      res.status(500).json({ error: "Internal server error" });
    }
  };
}
