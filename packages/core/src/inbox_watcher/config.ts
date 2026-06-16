import { resolveHarnessEnvRaw } from "../harness_effective_env.js";
import type { RuntimePreferences } from "../runtime_prefs.js";

function envInt(
  name: string,
  prefs: RuntimePreferences | null,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = resolveHarnessEnvRaw(name, prefs)?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function envFloat(
  name: string,
  prefs: RuntimePreferences | null,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = resolveHarnessEnvRaw(name, prefs)?.trim();
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
  /** Max existing inbox messages to triage on first connect (0 = incremental only). */
  backfillMax: number;
  /** Escalate urgent/action mail to the agent without a manual Process click. */
  autoProcess: boolean;
}

/** Pass runtime prefs when resolving outside an active harness `send()` (e.g. sidecar background). */
export function resolveInboxWatcherConfig(prefs: RuntimePreferences | null = null): InboxWatcherConfig {
  return {
    enabled: resolveHarnessEnvRaw("AGENT_INBOX_WATCH", prefs) === "1",
    intervalMs: envInt("AGENT_INBOX_WATCH_INTERVAL_MS", prefs, 300_000, 60_000, 3_600_000),
    minIntervalMs: envInt("AGENT_INBOX_WATCH_MIN_INTERVAL_MS", prefs, 60_000, 10_000, 600_000),
    watchWhileBusy: resolveHarnessEnvRaw("AGENT_INBOX_WATCH_WHILE_BUSY", prefs) === "1",
    maxTriagePerCycle: envInt("AGENT_INBOX_WATCH_MAX_TRIAGE_PER_CYCLE", prefs, 25, 1, 50),
    autoLabel: resolveHarnessEnvRaw("AGENT_INBOX_AUTO_LABEL", prefs) !== "0",
    autoSpamLabel: resolveHarnessEnvRaw("AGENT_INBOX_AUTO_SPAM_LABEL", prefs) === "1",
    triageConfidenceMin: envFloat("AGENT_INBOX_TRIAGE_CONFIDENCE_MIN", prefs, 0.75, 0.5, 0.99),
    notifyUrgent: resolveHarnessEnvRaw("AGENT_INBOX_NOTIFY_URGENT", prefs) !== "0",
    triageTimeoutMs: envInt("AGENT_INBOX_TRIAGE_TIMEOUT_MS", prefs, 6_000, 2_000, 30_000),
    backfillMax: envInt("AGENT_INBOX_BACKFILL_MAX", prefs, 25, 0, 100),
    autoProcess: resolveHarnessEnvRaw("AGENT_INBOX_AUTO_PROCESS", prefs) !== "0",
  };
}

/** Gmail label / Outlook category to apply for a triage verdict. */
export function resolveLabelForVerdict(verdict: {
  category: string;
  suggestedLabel?: string;
}): string | null {
  const suggested = verdict.suggestedLabel?.trim();
  if (suggested?.startsWith("Liminal/")) return suggested.slice(0, 80);
  return labelNameForCategory(verdict.category);
}

export function shouldAutoLabelVerdict(
  verdict: { category: string; confidence: number },
  cfg: Pick<InboxWatcherConfig, "autoSpamLabel" | "triageConfidenceMin">
): boolean {
  if (verdict.category === "spam" && !cfg.autoSpamLabel) return false;
  return verdict.confidence >= autoLabelConfidenceFloor(verdict.category, cfg.triageConfidenceMin);
}

/** Min confidence to auto-apply a label by category. */
export function autoLabelConfidenceFloor(category: string, triageConfidenceMin = 0.75): number {
  if (category === "newsletter" || category === "automated") return 0.85;
  if (category === "fyi") return 0.8;
  if (category === "spam") return 0.9;
  return triageConfidenceMin;
}

export function labelNameForCategory(category: string): string | null {
  switch (category) {
    case "urgent":
      return "Liminal/Urgent";
    case "action":
      return "Liminal/Action";
    case "newsletter":
      return "Liminal/Newsletter";
    case "automated":
      return "Liminal/Automated";
    case "fyi":
      return "Liminal/FYI";
    case "spam":
      return "Liminal/Spam";
    default:
      return "Liminal/Review";
  }
}
