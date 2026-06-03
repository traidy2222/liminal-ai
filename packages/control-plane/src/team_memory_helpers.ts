import type { LicenseAuthedRequest } from "./license_auth.js";

/** Note payload shape stored in org_memory_notes.payload (jsonb). */
export type TeamNotePayload = {
  scope?: "chat" | "workspace" | "global";
  userId?: string;
  updatedAt?: string;
  deletedAt?: string;
};

/** Team org store only replicates workspace + global notes (never chat-scoped). */
export function isTeamSyncableScope(scope: string | undefined): boolean {
  return scope !== "chat";
}

export function notePayloadScope(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const s = (payload as TeamNotePayload).scope;
  return typeof s === "string" ? s : undefined;
}

/** Reject chat-scoped uploads to the org store. */
export function assertTeamSyncablePayload(payload: unknown, noteKey: string): void {
  const scope = notePayloadScope(payload);
  if (scope === "chat") {
    throw new TeamMemoryPolicyError(`chat-scoped note ${noteKey} cannot be stored in team memory`);
  }
}

export class TeamMemoryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamMemoryPolicyError";
  }
}

/**
 * When the license carries `org`, the request must target that org (prevents cross-org probing).
 */
export function assertLicenseOrgMatch(req: LicenseAuthedRequest, orgId: string): void {
  const licenseOrg = req.licenseResolved?.license?.org?.trim();
  if (licenseOrg && licenseOrg !== orgId) {
    throw new TeamMemoryPolicyError("org_id does not match license");
  }
}
