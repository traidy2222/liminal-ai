import type OpenAI from "openai";
import {
  autoLabelConfidenceFloor,
  labelNameForCategory,
  resolveInboxWatcherConfig,
  type InboxWatcherConfig,
} from "./config.js";
import {
  appendTriageAudit,
  buildInboxStatusSnapshot,
  makeItemId,
  markProcessedIds,
  readInboxQueue,
  readInboxRules,
  readProcessedIds,
  readProviderCursor,
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
}

let lastCycleAt = 0;
let inFlight = false;

export function resetInboxWatcherCycleStateForTests(): void {
  lastCycleAt = 0;
  inFlight = false;
}

export async function runInboxWatchCycle(deps: InboxWatchCycleDeps): Promise<InboxWatchCycleResult> {
  const started = Date.now();
  const cfg = deps.config ?? resolveInboxWatcherConfig();

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
  if (lastCycleAt > 0 && now - lastCycleAt < cfg.minIntervalMs) {
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
    const processed = await readProcessedIds();
    const newItems: InboxTriagedItem[] = [];
    let anyChange = false;

    for (const poll of deps.polls) {
      const cursor = await readProviderCursor(poll.provider, poll.accountId);
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
      });

      if (!result.baselineEstablished && result.messages.length === 0) {
        continue;
      }

      const fresh = result.messages.filter((m) => !processed.has(m.id) && !processed.has(makeItemId(m)));
      if (fresh.length === 0) {
        continue;
      }

      anyChange = true;
      newCount += fresh.length;

      const batch = fresh.slice(0, cfg.maxTriagePerCycle);
      for (const message of batch) {
        const verdict =
          deps.client != null
            ? await triageInboxMessage(deps.client, deps.mainModel, message, rules)
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

        const label = labelNameForCategory(verdict.category);
        const shouldLabel =
          cfg.autoLabel &&
          label &&
          verdict.confidence >= autoLabelConfidenceFloor(verdict.category) &&
          (verdict.category !== "spam" || cfg.autoSpamLabel) &&
          poll.applyLabel;

        if (shouldLabel && poll.applyLabel) {
          const lr = await poll.applyLabel(message, label);
          if (lr.ok) {
            item.status = "labeled";
            item.labeledAt = new Date().toISOString();
            labeledCount += 1;
          }
        }

        newItems.push(item);
        await appendTriageAudit({
          itemId: item.itemId,
          category: verdict.category,
          confidence: verdict.confidence,
          source: verdict.source,
          provider: message.provider,
        });
      }

      await markProcessedIds(fresh.map((m) => m.id));
    }

    if (!anyChange) {
      return skip("no_change", started);
    }

    const queue = await upsertQueueItems(newItems);
    const snapshot = buildInboxStatusSnapshot(queue, new Date().toISOString(), null);
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

export async function getInboxStatusSnapshot(): Promise<ReturnType<typeof buildInboxStatusSnapshot>> {
  const queue = await readInboxQueue();
  const lastScan = queue[0]?.triagedAt ?? null;
  return buildInboxStatusSnapshot(queue, lastScan, null);
}
