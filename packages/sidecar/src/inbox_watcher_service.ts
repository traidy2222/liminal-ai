import OpenAI from "openai";
import {
  buildInboxProcessPrompt,
  getInboxStatusSnapshot,
  readInboxQueue,
  resolveInboxWatcherConfig,
  runInboxWatchCycle,
  updateQueueItemStatus,
  writeInboxRules,
  type InboxRules,
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
    const cfg = resolveInboxWatcherConfig();
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

  async runOnce(trigger: string): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    const cfg = resolveInboxWatcherConfig();
    try {
      if (!cfg.enabled) {
        this.emitSkipped("disabled");
        return;
      }

      let polls;
      try {
        polls = await createInboxProviderPolls();
      } catch (e) {
        this.emitSkipped("error", undefined, e instanceof Error ? e.message : String(e));
        return;
      }

      if (polls.length === 0) {
        this.emitSkipped("no_connector");
        return;
      }

      this.sink(serverFrame("inbox_watch_started", { trigger, providers: polls.length }));

      const bridge = this.registry.getActiveBridge();

      const result = await runInboxWatchCycle({
        polls,
        client: this.client,
        mainModel: this.provider.model,
        harnessBusy: () => Boolean(bridge?.isBusy),
      });

      if (result.skipped) {
        this.emitSkipped(result.skipReason ?? "no_change", result.provider, result.error);
        return;
      }

      const status = await getInboxStatusSnapshot();
      this.sink(
        serverFrame("inbox_watch_completed", {
          trigger,
          newCount: result.newCount,
          triagedCount: result.triagedCount,
          labeledCount: result.labeledCount,
          needsActionCount: result.needsActionCount,
          durationMs: result.durationMs,
        })
      );
      this.emitStatus(status);

      if (cfg.notifyUrgent && result.needsActionCount > 0) {
        this.sink(
          serverFrame("inbox_notify", {
            needsActionCount: result.needsActionCount,
            message: `${result.needsActionCount} inbox item(s) need your attention`,
          })
        );
      }
    } finally {
      this.inFlight = false;
    }
  }

  async getStatus() {
    return getInboxStatusSnapshot();
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
      this.emitStatus();
      return { ok: true };
    } catch (e) {
      await updateQueueItemStatus(items.map((i) => i.itemId), "pending");
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async dismissItems(itemIds: string[]): Promise<void> {
    await updateQueueItemStatus(itemIds, "dismissed");
    this.emitStatus();
  }

  async updateRules(rules: InboxRules): Promise<void> {
    await writeInboxRules(rules);
  }

  private emitSkipped(reason: string, provider?: string, error?: string): void {
    const cfg = resolveInboxWatcherConfig();
    const nextScanAt = new Date(Date.now() + cfg.intervalMs).toISOString();
    this.sink(serverFrame("inbox_watch_skipped", { reason, provider, nextScanAt, error }));
  }

  emitStatus(status?: Awaited<ReturnType<typeof getInboxStatusSnapshot>>): void {
    const now = Date.now();
    if (now - this.lastStatusAt < 500) return;
    this.lastStatusAt = now;
    void (status ? Promise.resolve(status) : getInboxStatusSnapshot()).then((snap) => {
      this.sink(serverFrame("inbox_status", snap));
    });
  }
}
