import { randomUUID } from "node:crypto";
import type { InboxWatchCycleResult, InboxWatchRunEntry } from "./types.js";
import { appendInboxWatchRun, readRecentInboxWatchRuns } from "./state.js";

export type { InboxWatchRunEntry } from "./types.js";

export function summarizeInboxWatchRun(entry: {
  outcome: "completed" | "skipped";
  skipReason?: string;
  provider?: string;
  error?: string;
  newCount: number;
  triagedCount: number;
  labeledCount: number;
  needsActionCount: number;
}): string {
  if (entry.outcome === "skipped") {
    switch (entry.skipReason) {
      case "no_change":
        return "No new mail since last scan";
      case "baseline_set":
        return "Linked inbox — import unread mail on next scan";
      case "no_connector":
        return "No Gmail or Outlook connector";
      case "disabled":
        return "Inbox watcher is disabled";
      case "throttled":
        return "Throttled — try again in a minute";
      case "busy":
        return "Skipped while agent is busy";
      case "in_flight":
        return "Scan already in progress";
      case "auth_expired":
        return `Mail auth expired${entry.provider ? ` (${entry.provider})` : ""} — reconnect`;
      case "error":
        return entry.error ? `Error: ${entry.error}` : "Scan failed";
      default:
        return entry.skipReason ? `Skipped: ${entry.skipReason}` : "Skipped";
    }
  }
  const parts: string[] = [];
  if (entry.newCount > 0) parts.push(`${entry.newCount} new`);
  if (entry.triagedCount > 0) parts.push(`${entry.triagedCount} triaged`);
  if (entry.labeledCount > 0) parts.push(`${entry.labeledCount} labeled`);
  if (entry.needsActionCount > 0) parts.push(`${entry.needsActionCount} need you`);
  return parts.length > 0 ? parts.join(" · ") : "Scan complete — no new mail";
}

export function buildInboxWatchRunEntry(
  trigger: string,
  startedAt: number,
  result: InboxWatchCycleResult
): InboxWatchRunEntry {
  const finishedAt = new Date().toISOString();
  const outcome: InboxWatchRunEntry["outcome"] = result.skipped ? "skipped" : "completed";
  const base = {
    runId: randomUUID(),
    trigger,
    startedAt: new Date(startedAt).toISOString(),
    finishedAt,
    durationMs: result.durationMs,
    outcome,
    skipReason: result.skipReason,
    provider: result.provider,
    error: result.error,
    newCount: result.newCount,
    triagedCount: result.triagedCount,
    labeledCount: result.labeledCount,
    needsActionCount: result.needsActionCount,
  };
  return { ...base, summary: summarizeInboxWatchRun(base) };
}

export async function recordInboxWatchRun(
  trigger: string,
  startedAt: number,
  result: InboxWatchCycleResult
): Promise<InboxWatchRunEntry> {
  const entry = buildInboxWatchRunEntry(trigger, startedAt, result);
  await appendInboxWatchRun(entry);
  return entry;
}

export async function loadRecentInboxWatchRuns(limit = 30): Promise<InboxWatchRunEntry[]> {
  return readRecentInboxWatchRuns(limit);
}
