import OpenAI from "openai";
import {
  buildInboxProcessPrompt,
  getInboxStatusSnapshot,
  readInboxQueue,
  recordInboxWatchRun,
  resolveInboxWatcherConfig,
  runInboxWatchCycle,
  updateQueueItemStatus,
  writeInboxRules,
  type InboxRules,
  type InboxWatchCycleResult,
  type InboxWatchRunEntry,
  type InboxProvider,
  type ProviderConfig,
} from "@liminal/core";
import { createInboxProviderPolls } from "@liminal/tools";
import { serverFrame, type ServerFrame } from "@liminal/protocol";
import type { ChatRegistry } from "./chat_registry.js";

export type InboxFrameSink = (frame: ServerFrame) => void;

/**
 * Background inbox watcher — polls Gmail/Graph on an interval with zero-LLM pre-check.
 */
export class InboxWatcherService {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private readonly sink: InboxFrameSink;
  private readonly registry: ChatRegistry;
  private readonly provider: ProviderConfig;
  private readonly client: OpenAI;
  private lastStatusAt = 0;

  constructor(sink: InboxFrameSink, registry: ChatRegistry, provider: ProviderConfig) {
    this.sink = sink;
    this.registry = registry;
    this.provider = provider;
    this.client = new OpenAI({
      apiKey: provider.apiKey,
      baseURL: provider.baseURL,
    });
  }

  start(): void {
    const cfg = resolveInboxWatcherConfig(this.registry.getRuntimePreferences());
    if (!cfg.enabled) return;
    this.stop();
    void this.runOnce("boot");
    this.timer = setInterval(() => void this.runOnce("interval"), cfg.intervalMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Re-read config and reschedule (after settings change). */
  restart(): void {
    this.stop();
    this.start();
  }

  async runOnce(trigger: string): Promise<InboxWatchRunEntry | null> {
    const started = Date.now();
    const prefs = this.registry.getRuntimePreferences();
    const cfg = resolveInboxWatcherConfig(prefs);

    if (this.inFlight) {
      const entry = await recordInboxWatchRun(trigger, started, {
        skipped: true,
        skipReason: "in_flight",
        newCount: 0,
        triagedCount: 0,
        labeledCount: 0,
        needsActionCount: 0,
        durationMs: 0,
      });
      this.emitRun(entry);
      return entry;
    }

    this.inFlight = true;
    try {
      if (!cfg.enabled) {
        const entry = await this.finishSkipped(trigger, started, "disabled");
        return entry;
      }

      let polls;
      try {
        polls = await createInboxProviderPolls({ backfillMax: cfg.backfillMax });
      } catch (e) {
        const entry = await this.finishSkipped(trigger, started, "error", undefined, e);
        return entry;
      }

      if (polls.length === 0) {
        const entry = await this.finishSkipped(trigger, started, "no_connector");
        return entry;
      }

      this.sink(serverFrame("inbox_watch_started", { trigger, providers: polls.length }));

      const bridge = this.registry.getActiveBridge();

      const result = await runInboxWatchCycle({
        polls,
        client: this.client,
        mainModel: this.provider.model,
        harnessBusy: () => Boolean(bridge?.isBusy),
        config: cfg,
        trigger,
      });

      const entry = await recordInboxWatchRun(trigger, started, result);
      this.emitRun(entry);
      if (!result.skipped && cfg.autoProcess && result.needsActionCount > 0) {
        void this.autoProcessNeedsAction();
      }
      return entry;
    } finally {
      this.inFlight = false;
    }
  }

  private async finishSkipped(
    trigger: string,
    started: number,
    reason: InboxWatchCycleResult["skipReason"],
    provider?: InboxProvider,
    err?: unknown
  ): Promise<InboxWatchRunEntry> {
    const error = err instanceof Error ? err.message : err != null ? String(err) : undefined;
    const result: InboxWatchCycleResult = {
      skipped: true,
      skipReason: reason,
      provider,
      newCount: 0,
      triagedCount: 0,
      labeledCount: 0,
      needsActionCount: 0,
      durationMs: Date.now() - started,
      error,
    };
    const entry = await recordInboxWatchRun(trigger, started, result);
    this.emitRun(entry);
    return entry;
  }

  private emitRun(entry: InboxWatchRunEntry): void {
    const cfg = resolveInboxWatcherConfig(this.registry.getRuntimePreferences());
    const nextScanAt = new Date(Date.now() + cfg.intervalMs).toISOString();

    if (entry.outcome === "skipped") {
      this.sink(
        serverFrame("inbox_watch_skipped", {
          reason: entry.skipReason ?? "skipped",
          provider: entry.provider,
          nextScanAt,
          error: entry.error,
          run: entry,
        })
      );
    } else {
      this.sink(
        serverFrame("inbox_watch_completed", {
          trigger: entry.trigger,
          newCount: entry.newCount,
          triagedCount: entry.triagedCount,
          labeledCount: entry.labeledCount,
          needsActionCount: entry.needsActionCount,
          durationMs: entry.durationMs,
          run: entry,
        })
      );

      if (cfg.notifyUrgent && entry.needsActionCount > 0) {
        this.sink(
          serverFrame("inbox_notify", {
            needsActionCount: entry.needsActionCount,
            message: `${entry.needsActionCount} inbox item(s) need your attention`,
          })
        );
      }
    }

    void this.emitStatus(true);
  }

  async getStatus() {
    return getInboxStatusSnapshot(this.registry.getRuntimePreferences());
  }

  async processItems(itemIds: string[], chatId: string): Promise<{ ok: boolean; error?: string }> {
    const bridge = this.registry.get(chatId);
    if (!bridge) return { ok: false, error: "Unknown chatId" };
    if (bridge.isBusy) return { ok: false, error: "Agent is busy" };

    const queue = await readInboxQueue();
    const ids = new Set(itemIds);
    const items = queue.filter((i) => ids.has(i.itemId));
    if (items.length === 0) return { ok: false, error: "No matching inbox items" };

    await updateQueueItemStatus(items.map((i) => i.itemId), "processing");
    const prompt = buildInboxProcessPrompt(items);

    try {
      await bridge.sendUserMessage(prompt);
      await updateQueueItemStatus(items.map((i) => i.itemId), "done");
      void this.emitStatus(true);
      return { ok: true };
    } catch (e) {
      await updateQueueItemStatus(items.map((i) => i.itemId), "pending");
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async dismissItems(itemIds: string[]): Promise<void> {
    await updateQueueItemStatus(itemIds, "dismissed");
    void this.emitStatus(true);
  }

  async updateRules(rules: InboxRules): Promise<void> {
    await writeInboxRules(rules);
  }

  /** Background escalation — urgent/action mail to the active chat without a manual Process click. */
  private async autoProcessNeedsAction(): Promise<void> {
    const cfg = resolveInboxWatcherConfig(this.registry.getRuntimePreferences());
    if (!cfg.autoProcess) return;

    const bridge = this.registry.getActiveBridge();
    if (bridge?.isBusy) return;

    const queue = await readInboxQueue();
    const pending = queue.filter(
      (i) =>
        i.status === "pending" &&
        (i.verdict.category === "urgent" || i.verdict.category === "action")
    );
    if (pending.length === 0) return;

    let chatId = this.registry.activeId;
    if (!chatId) {
      try {
        chatId = (await this.registry.getOrCreateActive()).chatId;
      } catch {
        return;
      }
    }

    const batch = pending.slice(0, 5);
    await this.processItems(
      batch.map((i) => i.itemId),
      chatId
    );
  }

  emitStatus(force = false): void {
    const now = Date.now();
    if (!force && now - this.lastStatusAt < 500) return;
    this.lastStatusAt = now;
    void getInboxStatusSnapshot(this.registry.getRuntimePreferences()).then((snap) => {
      this.sink(serverFrame("inbox_status", snap));
    });
  }
}
