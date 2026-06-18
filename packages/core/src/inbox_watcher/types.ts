export type InboxProvider = "gmail" | "microsoft";

export type InboxTriageCategory =
  | "urgent"
  | "action"
  | "fyi"
  | "newsletter"
  | "automated"
  | "spam";

export type InboxTriageSource = "llm" | "heuristic" | "fallback";

export type InboxWatchSkipReason =
  | "disabled"
  | "no_connector"
  | "throttled"
  | "busy"
  | "no_change"
  | "baseline_set"
  | "auth_expired"
  | "in_flight"
  | "error";

export type InboxItemStatus = "pending" | "labeled" | "dismissed" | "processing" | "done";

export interface InboxMessageMeta {
  id: string;
  threadId?: string;
  provider: InboxProvider;
  accountId: string;
  /** Owning mailbox address (for multi-account reply routing). */
  accountEmail?: string;
  from: string;
  fromEmail: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  listUnsubscribe?: boolean;
}

export interface InboxTriageVerdict {
  category: InboxTriageCategory;
  needsReply: boolean;
  confidence: number;
  summary: string;
  suggestedLabel: string;
  reason: string;
  source: InboxTriageSource;
}

export interface InboxTriagedItem {
  itemId: string;
  message: InboxMessageMeta;
  verdict: InboxTriageVerdict;
  status: InboxItemStatus;
  labeledAt?: string;
  triagedAt: string;
}

export interface InboxProviderCursorState {
  provider: InboxProvider;
  accountId: string;
  /** Gmail historyId or Microsoft deltaLink URL */
  cursor: string;
  lastScanAt: string | null;
  baselineEstablished: boolean;
  /** One-time import of existing inbox mail completed. */
  backfillCompleted?: boolean;
}

export interface InboxRules {
  vipSenders: string[];
  newsletterDomains: string[];
  denyDomains: string[];
}

export const DEFAULT_INBOX_RULES: InboxRules = {
  vipSenders: [],
  newsletterDomains: [],
  denyDomains: [],
};

export interface InboxStatusSnapshot {
  lastScanAt: string | null;
  nextScanAt: string | null;
  needsActionCount: number;
  fyiCount: number;
  pendingCount: number;
  items: InboxTriagedItem[];
  /** Recent poll cycles (newest first) — activity log for UI */
  recentRuns?: InboxWatchRunEntry[];
}

export type InboxWatchRunOutcome = "completed" | "skipped";

export interface InboxWatchRunEntry {
  runId: string;
  trigger: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: InboxWatchRunOutcome;
  skipReason?: InboxWatchSkipReason | string;
  provider?: string;
  error?: string;
  newCount: number;
  triagedCount: number;
  labeledCount: number;
  needsActionCount: number;
  summary: string;
}

export interface InboxPrecheckResult {
  changed: boolean;
  cursor: string;
  baselineEstablished: boolean;
  authError?: string;
}

export interface InboxPollResult {
  ok: boolean;
  error?: string;
  messages: InboxMessageMeta[];
  cursor: string;
  baselineEstablished: boolean;
  backfillCompleted?: boolean;
}

export interface InboxLabelResult {
  ok: boolean;
  error?: string;
  labelApplied?: string;
}

/** Injectable per-provider poll (implemented in @liminal/tools, wired in sidecar). */
export interface InboxProviderPoll {
  provider: InboxProvider;
  accountId: string;
  email?: string;
  poll(cursorState: InboxProviderCursorState | null): Promise<InboxPollResult>;
  applyLabel?(message: InboxMessageMeta, labelName: string): Promise<InboxLabelResult>;
}

export interface InboxWatchCycleResult {
  skipped: boolean;
  skipReason?: InboxWatchSkipReason;
  provider?: InboxProvider;
  newCount: number;
  triagedCount: number;
  labeledCount: number;
  needsActionCount: number;
  durationMs: number;
  error?: string;
}
