/**
 * Control-plane cloud sync API shapes (CE types only — network in EE).
 */

import type { RawNotesStore } from "./stored_note.js";

export interface CloudSyncNotesPutBody {
  revision: number;
  notes: RawNotesStore;
  tombstones?: string[];
}

export interface CloudSyncNotesGetResponse {
  revision: number;
  notes: RawNotesStore;
  updatedAt: string;
}

export interface TeamMemoryNotesPutBody {
  orgId: string;
  workspaceFingerprint: string;
  revision: number;
  notes: RawNotesStore;
  tombstones?: string[];
}

export interface TeamMemoryNotesGetResponse {
  orgId: string;
  workspaceFingerprint: string;
  revision: number;
  notes: RawNotesStore;
  memberCount?: number;
  lastWriter?: string;
}

export interface SessionHistoryPostBody {
  sessionId: string;
  chunkIndex?: number;
  payload: Record<string, unknown>;
}

export interface TeamBusPublishBody {
  orgId: string;
  workspaceFingerprint: string;
  key: string;
  envelope: {
    type: "fact" | "summary" | "evidence" | "handoff" | "status";
    summary: string;
    evidenceRefs?: string[];
    payload?: string;
    at: number;
  };
}
