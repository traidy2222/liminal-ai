import type { Request, Response, NextFunction } from "express";

export interface RateLimitOptions {
  windowMs: number;
  max: number;
}

/** Simple in-memory sliding-window rate limiter keyed by client IP. */
export function createRateLimiter(options: RateLimitOptions) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + options.windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      res.status(429).json({ error: "too many requests" });
      return;
    }
    next();
  };
}
