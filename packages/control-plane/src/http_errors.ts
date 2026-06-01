import { randomUUID } from "node:crypto";
import type { Response } from "express";

const GENERIC_ERROR = "Internal server error";

export function newCorrelationId(): string {
  return randomUUID();
}

export function logServerError(scope: string, err: unknown, correlationId: string): void {
  console.error(`[control-plane] ${scope} correlation=${correlationId}`, err);
}

export function sendInternalError(res: Response, correlationId: string): void {
  res.status(500).json({ error: GENERIC_ERROR, correlationId });
}
