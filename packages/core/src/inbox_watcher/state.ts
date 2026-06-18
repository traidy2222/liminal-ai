import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalPath } from "../global_storage.js";
import type {
  InboxProvider,
  InboxProviderCursorState,
  InboxRules,
  InboxStatusSnapshot,
  InboxTriagedItem,
  InboxWatchRunEntry,
} from "./types.js";
import { DEFAULT_INBOX_RULES } from "./types.js";

const INBOX_DIR_SEG = "inbox";
const PROCESSED_MAX = 2000;
const QUEUE_MAX = 500;

function inboxRoot(): string {
  return globalPath(INBOX_DIR_SEG);
}

export async function ensureInboxDir(): Promise<string> {
  const root = inboxRoot();
  await mkdir(root, { recursive: true });
  return root;
}

function statePath(provider: InboxProvider, accountId: string): string {
  const safe = accountId.replace(/[^a-z0-9_-]/gi, "_");
  return path.join(inboxRoot(), `state-${provider}-${safe}.json`);
}

function queuePath(): string {
  return path.join(inboxRoot(), "queue.json");
}

function processedPath(): string {
  return path.join(inboxRoot(), "processed-ids.json");
}

function rulesPath(): string {
  return path.join(inboxRoot(), "rules.json");
}

function runsLogPath(): string {
  return path.join(inboxRoot(), "runs.jsonl");
}

const RUNS_LOG_MAX_LINES = 200;

export async function appendInboxWatchRun(entry: InboxWatchRunEntry): Promise<void> {
  await ensureInboxDir();
  const line = JSON.stringify(entry) + "\n";
  await appendFile(runsLogPath(), line, "utf8");
  try {
    const raw = await readFile(runsLogPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length > RUNS_LOG_MAX_LINES) {
      await writeFile(runsLogPath(), lines.slice(-RUNS_LOG_MAX_LINES).join("\n") + "\n", "utf8");
    }
  } catch {
    // best-effort trim
  }
}

export async function readRecentInboxWatchRuns(limit = 30): Promise<InboxWatchRunEntry[]> {
  try {
    const raw = await readFile(runsLogPath(), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    const out: InboxWatchRunEntry[] = [];
    for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
      try {
        out.push(JSON.parse(lines[i]!) as InboxWatchRunEntry);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

function triageLogPath(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return path.join(inboxRoot(), `triage-${y}-${m}-${d}.jsonl`);
}

export async function readProviderCursor(
  provider: InboxProvider,
  accountId: string
): Promise<InboxProviderCursorState | null> {
  try {
    const raw = await readFile(statePath(provider, accountId), "utf8");
    return JSON.parse(raw) as InboxProviderCursorState;
  } catch {
    return null;
  }
}

export async function writeProviderCursor(state: InboxProviderCursorState): Promise<void> {
  await ensureInboxDir();
  await writeFile(statePath(state.provider, state.accountId), JSON.stringify(state, null, 2), "utf8");
}

interface ProcessedStore {
  ids: string[];
}

export async function readProcessedIds(): Promise<Set<string>> {
  try {
    const raw = await readFile(processedPath(), "utf8");
    const parsed = JSON.parse(raw) as ProcessedStore;
    return new Set(Array.isArray(parsed.ids) ? parsed.ids : []);
  } catch {
    return new Set();
  }
}

export async function markProcessedIds(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await ensureInboxDir();
  const existing = await readProcessedIds();
  for (const id of ids) existing.add(id);
  const ring = [...existing].slice(-PROCESSED_MAX);
  await writeFile(processedPath(), JSON.stringify({ ids: ring }, null, 2), "utf8");
}

export function makeItemId(message: { provider: string; accountId: string; id: string }): string {
  return `${message.provider}:${message.accountId}:${message.id}`;
}

interface QueueStore {
  items: InboxTriagedItem[];
  updatedAt: string;
}

export async function readInboxQueue(): Promise<InboxTriagedItem[]> {
  try {
    const raw = await readFile(queuePath(), "utf8");
    const parsed = JSON.parse(raw) as QueueStore;
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export async function writeInboxQueue(items: InboxTriagedItem[]): Promise<void> {
  await ensureInboxDir();
  const trimmed = items.slice(-QUEUE_MAX);
  const store: QueueStore = { items: trimmed, updatedAt: new Date().toISOString() };
  await writeFile(queuePath(), JSON.stringify(store, null, 2), "utf8");
}

export async function upsertQueueItems(incoming: InboxTriagedItem[]): Promise<InboxTriagedItem[]> {
  const queue = await readInboxQueue();
  const byId = new Map(queue.map((i) => [i.itemId, i]));
  for (const item of incoming) {
    const prev = byId.get(item.itemId);
    byId.set(item.itemId, prev ? { ...prev, ...item, status: prev.status === "done" ? "done" : item.status } : item);
  }
  const merged = [...byId.values()].sort((a, b) => b.triagedAt.localeCompare(a.triagedAt));
  await writeInboxQueue(merged);
  return merged;
}

export async function updateQueueItemStatus(
  itemIds: string[],
  status: InboxTriagedItem["status"]
): Promise<InboxTriagedItem[]> {
  const ids = new Set(itemIds);
  const queue = await readInboxQueue();
  const next = queue.map((item) =>
    ids.has(item.itemId) ? { ...item, status, ...(status === "labeled" ? { labeledAt: new Date().toISOString() } : {}) } : item
  );
  await writeInboxQueue(next);
  return next;
}

/** Items stuck in `processing` return to `pending` when older than maxAgeMs (0 = any age). */
export async function recoverStaleProcessingQueueItems(maxAgeMs = 45 * 60 * 1000): Promise<number> {
  const queue = await readInboxQueue();
  const cutoff = maxAgeMs <= 0 ? Number.POSITIVE_INFINITY : Date.now() - maxAgeMs;
  let recovered = 0;
  const next = queue.map((item) => {
    if (item.status !== "processing") return item;
    if (maxAgeMs > 0) {
      const at = Date.parse(item.triagedAt);
      if (!Number.isFinite(at) || at > cutoff) return item;
    }
    recovered += 1;
    return { ...item, status: "pending" as const };
  });
  if (recovered > 0) await writeInboxQueue(next);
  return recovered;
}

export async function readInboxRules(): Promise<InboxRules> {
  try {
    const raw = await readFile(rulesPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<InboxRules>;
    return {
      vipSenders: Array.isArray(parsed.vipSenders) ? parsed.vipSenders.map(String) : [],
      newsletterDomains: Array.isArray(parsed.newsletterDomains) ? parsed.newsletterDomains.map(String) : [],
      denyDomains: Array.isArray(parsed.denyDomains) ? parsed.denyDomains.map(String) : [],
    };
  } catch {
    return { ...DEFAULT_INBOX_RULES };
  }
}

export async function writeInboxRules(rules: InboxRules): Promise<void> {
  await ensureInboxDir();
  await writeFile(rulesPath(), JSON.stringify(rules, null, 2), "utf8");
}

export async function appendTriageAudit(entry: Record<string, unknown>): Promise<void> {
  await ensureInboxDir();
  const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + "\n";
  await appendFile(triageLogPath(), line, "utf8");
}

export function buildInboxStatusSnapshot(
  items: InboxTriagedItem[],
  lastScanAt: string | null,
  nextScanAt: string | null,
  recentRuns: InboxWatchRunEntry[] = []
): InboxStatusSnapshot {
  const pending = items.filter(
    (i) => i.status === "pending" || i.status === "labeled" || i.status === "processing"
  );
  const needsAction = pending.filter(
    (i) => i.verdict.category === "urgent" || i.verdict.category === "action"
  );
  const fyi = pending.filter((i) => i.verdict.category === "fyi");
  return {
    lastScanAt,
    nextScanAt,
    needsActionCount: needsAction.length,
    fyiCount: fyi.length,
    pendingCount: pending.length,
    items: pending.slice(0, 100),
    recentRuns: recentRuns.slice(0, 30),
  };
}

export function buildInboxProcessPrompt(items: InboxTriagedItem[]): string {
  const lines = items.map((item, idx) => {
    const m = item.message;
    const mailbox = m.accountEmail ?? m.accountId;
    return (
      `${idx + 1}. [${item.verdict.category}] ${m.subject}\n` +
      `   Mailbox: ${mailbox} (${m.provider})\n` +
      `   From: ${m.from} <${m.fromEmail}>\n` +
      `   messageId=${m.id}${m.threadId ? `, threadId=${m.threadId}` : ""}\n` +
      `   Summary: ${item.verdict.summary}\n` +
      `   Suggested: ${item.verdict.needsReply ? `draft reply from ${mailbox} (account_hint="${mailbox}")` : "label/archive as appropriate"}`
    );
  });
  return (
    "[INBOX PROCESS — automated triage escalation; not casual chat]\n" +
    "Process the following triaged inbox items. Use mail tools to draft replies (never send without approval), " +
    "apply labels, or mark handled. **Each item lists its Mailbox** — pass that as account_hint on compose/send tools. " +
    "Confirm what you did for each item.\n\n" +
    lines.join("\n\n")
  );
}
