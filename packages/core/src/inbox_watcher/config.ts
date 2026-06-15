import { effectiveHarnessEnvRaw } from "../harness_effective_env.js";

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = effectiveHarnessEnvRaw(name)?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function envFloat(name: string, fallback: number, min: number, max: number): number {
  const raw = effectiveHarnessEnvRaw(name)?.trim();
  if (!raw) return fallback;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export interface InboxWatcherConfig {
  enabled: boolean;
  intervalMs: number;
  minIntervalMs: number;
  watchWhileBusy: boolean;
  maxTriagePerCycle: number;
  autoLabel: boolean;
  autoSpamLabel: boolean;
  triageConfidenceMin: number;
  notifyUrgent: boolean;
  triageTimeoutMs: number;
}

export function resolveInboxWatcherConfig(): InboxWatcherConfig {
  return {
    enabled: effectiveHarnessEnvRaw("AGENT_INBOX_WATCH") === "1",
    intervalMs: envInt("AGENT_INBOX_WATCH_INTERVAL_MS", 300_000, 60_000, 3_600_000),
    minIntervalMs: envInt("AGENT_INBOX_WATCH_MIN_INTERVAL_MS", 60_000, 10_000, 600_000),
    watchWhileBusy: effectiveHarnessEnvRaw("AGENT_INBOX_WATCH_WHILE_BUSY") === "1",
    maxTriagePerCycle: envInt("AGENT_INBOX_WATCH_MAX_TRIAGE_PER_CYCLE", 10, 1, 50),
    autoLabel: effectiveHarnessEnvRaw("AGENT_INBOX_AUTO_LABEL") !== "0",
    autoSpamLabel: effectiveHarnessEnvRaw("AGENT_INBOX_AUTO_SPAM_LABEL") === "1",
    triageConfidenceMin: envFloat("AGENT_INBOX_TRIAGE_CONFIDENCE_MIN", 0.75, 0.5, 0.99),
    notifyUrgent: effectiveHarnessEnvRaw("AGENT_INBOX_NOTIFY_URGENT") !== "0",
    triageTimeoutMs: envInt("AGENT_INBOX_TRIAGE_TIMEOUT_MS", 6_000, 2_000, 30_000),
  };
}

/** Min confidence to auto-apply a label by category. */
export function autoLabelConfidenceFloor(category: string): number {
  if (category === "newsletter" || category === "automated") return 0.85;
  if (category === "fyi") return 0.8;
  if (category === "spam") return 0.9;
  return 1.0;
}

export function labelNameForCategory(category: string): string | null {
  switch (category) {
    case "newsletter":
      return "Liminal/Newsletter";
    case "automated":
      return "Liminal/Automated";
    case "fyi":
      return "Liminal/FYI";
    case "spam":
      return "Liminal/Spam";
    default:
      return null;
  }
}
