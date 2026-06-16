import type OpenAI from "openai";
import type { RuntimePreferences } from "../runtime_prefs.js";
import {
  resolveInboxWatcherConfig,
  resolveLabelForVerdict,
  shouldAutoLabelVerdict,
  type InboxWatcherConfig,
} from "./config.js";
import {
  appendTriageAudit,
  buildInboxStatusSnapshot,
  makeItemId,
  markProcessedIds,
  readInboxQueue,
  readInboxRules,
  readProviderCursor,
  readRecentInboxWatchRuns,
  recoverStaleProcessingQueueItems,
  upsertQueueItems,
  writeProviderCursor,
} from "./state.js";
import { triageInboxMessage, triageInboxWithRules } from "./inbox_triage.js";
import { tryHeuristicInboxTriage } from "./heuristics.js";
import type {
  InboxProviderPoll,
  InboxTriagedItem,
  InboxWatchCycleResult,
  InboxWatchSkipReason,
} from "./types.js";

export interface InboxWatchCycleDeps {
  polls: InboxProviderPoll[];
  client: OpenAI | null;
  mainModel: string;
  harnessBusy: () => boolean;
  config?: InboxWatcherConfig;
  /** When `manual`, bypasses min-interval throttle (Scan now). */
  trigger?: string;
}

let lastCycleAt = 0;
let inFlight = false;

export function resetInboxWatcherCycleStateForTests(): void {
  lastCycleAt = 0;
  inFlight = false;
}

export async function runInboxWatchCycle(deps: InboxWatchCycleDeps): Promise<InboxWatchCycleResult> {
  const started = Date.now();
  const cfg = deps.config ?? resolveInboxWatcherConfig(null);

  if (!cfg.enabled) {
    return skip("disabled", started);
  }
  if (inFlight) {
    return skip("in_flight", started);
  }
  if (deps.polls.length === 0) {
    return skip("no_connector", started);
  }
  if (!cfg.watchWhileBusy && deps.harnessBusy()) {
    return skip("busy", started);
  }
  const now = Date.now();
  const bypassThrottle = deps.trigger === "manual";
  if (lastCycleAt > 0 && now - lastCycleAt < cfg.minIntervalMs && !bypassThrottle) {
    return skip("throttled", started);
  }

  inFlight = true;
  lastCycleAt = now;

  let newCount = 0;
  let triagedCount = 0;
  let labeledCount = 0;
  let needsActionCount = 0;

  try {
    const rules = await readInboxRules();
    let queue = await readInboxQueue();
    if (!deps.harnessBusy()) {
      await recoverStaleProcessingQueueItems(0);
      queue = await readInboxQueue();
    } else {
      await recoverStaleProcessingQueueItems();
      queue = await readInboxQueue();
    }
    const newItems: InboxTriagedItem[] = [];
    let anyChange = false;
    let baselineJustEstablished = false;

    for (const poll of deps.polls) {
      const cursor = await readProviderCursor(poll.provider, poll.accountId);
      const hadBaseline = cursor?.baselineEstablished ?? false;
      const result = await poll.poll(cursor);

      if (!result.ok) {
        const auth = result.error?.toLowerCase().includes("oauth") || result.error?.toLowerCase().includes("token");
        if (auth) {
          return {
            skipped: true,
            skipReason: "auth_expired",
            provider: poll.provider,
            newCount: 0,
            triagedCount: 0,
            labeledCount: 0,
            needsActionCount: 0,
            durationMs: Date.now() - started,
            error: result.error,
          };
        }
        continue;
      }

      await writeProviderCursor({
        provider: poll.provider,
        accountId: poll.accountId,
        cursor: result.cursor,
        lastScanAt: new Date().toISOString(),
        baselineEstablished: result.baselineEstablished,
        backfillCompleted:
          result.backfillCompleted ?? cursor?.backfillCompleted ?? false,
      });

      if (!hadBaseline && result.baselineEstablished) {
        baselineJustEstablished = true;
      }

      if (!result.baselineEstablished && result.messages.length === 0) {
        continue;
      }

      const fresh = result.messages.filter((m) => {
        const itemId = makeItemId(m);
        const existing = queue.find((q) => q.itemId === itemId || q.message.id === m.id);
        if (existing?.status === "done" || existing?.status === "dismissed") return false;
        if (existing) return false;
        return true;
      });
      if (fresh.length === 0) {
        continue;
      }

      anyChange = true;
      newCount += fresh.length;

      const batch = fresh.slice(0, cfg.maxTriagePerCycle);
      const triagedIds: string[] = [];
      for (const message of batch) {
        const verdict =
          deps.client != null
            ? await triageInboxMessage(deps.client, deps.mainModel, message, rules, cfg)
            : tryHeuristicInboxTriage(message, rules) ?? triageInboxWithRules(message);

        triagedCount += 1;
        const item: InboxTriagedItem = {
          itemId: makeItemId(message),
          message,
          verdict,
          status: "pending",
          triagedAt: new Date().toISOString(),
        };

        if (verdict.category === "urgent" || verdict.category === "action") {
          needsActionCount += 1;
        }

        const label = resolveLabelForVerdict(verdict);
        const shouldLabel =
          cfg.autoLabel && label && shouldAutoLabelVerdict(verdict, cfg) && poll.applyLabel;

        if (shouldLabel && poll.applyLabel) {
          const lr = await poll.applyLabel(message, label);
          if (lr.ok) {
            item.labeledAt = new Date().toISOString();
            labeledCount += 1;
            const needsAgent =
              verdict.category === "urgent" || verdict.category === "action";
            item.status = needsAgent ? "pending" : "done";
          } else {
            await appendTriageAudit({
              itemId: item.itemId,
              labelError: lr.error ?? "label apply failed",
              provider: message.provider,
            });
          }
        }

        newItems.push(item);
        triagedIds.push(message.id);
        await appendTriageAudit({
          itemId: item.itemId,
          category: verdict.category,
          confidence: verdict.confidence,
          source: verdict.source,
          provider: message.provider,
        });
      }

      if (triagedIds.length > 0) {
        await markProcessedIds(triagedIds);
      }
    }

    if (!anyChange) {
      if (baselineJustEstablished) {
        return skip("baseline_set", started);
      }
      return skip("no_change", started);
    }

    const mergedQueue = await upsertQueueItems(newItems);
    const recentRuns = await readRecentInboxWatchRuns(30);
    const snapshot = buildInboxStatusSnapshot(mergedQueue, new Date().toISOString(), null, recentRuns);
    needsActionCount = snapshot.needsActionCount;

    return {
      skipped: false,
      newCount,
      triagedCount,
      labeledCount,
      needsActionCount,
      durationMs: Date.now() - started,
    };
  } catch (e) {
    return {
      skipped: true,
      skipReason: "error",
      newCount,
      triagedCount,
      labeledCount,
      needsActionCount,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    inFlight = false;
  }
}

function skip(reason: InboxWatchSkipReason, started: number): InboxWatchCycleResult {
  return {
    skipped: true,
    skipReason: reason,
    newCount: 0,
    triagedCount: 0,
    labeledCount: 0,
    needsActionCount: 0,
    durationMs: Date.now() - started,
  };
}

export async function getInboxStatusSnapshot(
  prefs: RuntimePreferences | null = null
): Promise<ReturnType<typeof buildInboxStatusSnapshot>> {
  const queue = await readInboxQueue();
  const recentRuns = await readRecentInboxWatchRuns(30);
  const lastScan = recentRuns[0]?.finishedAt ?? queue[0]?.triagedAt ?? null;
  const cfg = resolveInboxWatcherConfig(prefs);
  const nextScanAt =
    cfg.enabled && recentRuns[0]
      ? new Date(Date.parse(recentRuns[0].finishedAt) + cfg.intervalMs).toISOString()
      : null;
  return buildInboxStatusSnapshot(queue, lastScan, nextScanAt, recentRuns);
}
