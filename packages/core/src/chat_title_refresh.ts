/**
 * Background chat title refresh — fast-model sidecar on `turn_end`.
 *
 * Runs fire-and-forget (never blocks the harness turn). Debounced per chat so
 * titles evolve as the conversation grows without spamming the provider.
 */
import OpenAI from "openai";
import type { RuntimePreferences } from "./runtime_prefs.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { resolveProviderConfig } from "./provider_config.js";
import { loadChatTranscriptFromSessionLog } from "./chat_session_replay.js";
import { readChatMetadata, setChatTitle } from "./chat_metadata.js";
import {
  buildChatTitleTranscriptExcerpt,
  chatTitleRefreshEligible,
  countUserTurns,
  normalizeGeneratedChatTitle,
  resolveChatTitleRefreshConfig,
  shouldRefreshTitleAtTurn,
  type ChatTitleRefreshConfig,
} from "./chat_title_refresh_logic.js";

export type { ChatTitleRefreshConfig } from "./chat_title_refresh_logic.js";
export {
  resolveChatTitleRefreshConfig,
  shouldRefreshTitleAtTurn,
  buildChatTitleTranscriptExcerpt,
  chatTitleRefreshEligible,
  countUserTurns,
  normalizeGeneratedChatTitle,
} from "./chat_title_refresh_logic.js";

const TITLE_SYSTEM = `You name ongoing agent chat sessions for a sidebar list.
Return JSON only: {"title":"..."}

Rules:
- 3–12 words, sentence case, specific to what the user is working on
- No quotes, no trailing period, no "Chat about" filler
- Prefer concrete nouns (project, task, deliverable) over generic labels
- If the thread is still vague, use the clearest topic so far`;

export interface ChatTitleRefresherDeps {
  getRuntimePrefs?: () => RuntimePreferences | null;
  onTitleUpdated: (chatId: string, title: string) => void | Promise<void>;
}

interface ChatTitleSlotState {
  lastRefreshAt: number;
  lastRefreshedTurn: number;
  inFlight: boolean;
}

/** Per-process scheduler — one instance per server/sidecar. */
export class ChatTitleRefresher {
  private readonly slots = new Map<string, ChatTitleSlotState>();
  private readonly deps: ChatTitleRefresherDeps;

  constructor(deps: ChatTitleRefresherDeps) {
    this.deps = deps;
  }

  /** Non-blocking — safe to call from `turn_end` handlers. */
  scheduleAfterTurn(chatId: string): void {
    // Session jsonl writes text_rollup on turn_end asynchronously — brief delay
    // so the title model sees the assistant reply, not just the user message.
    void new Promise((resolve) => setTimeout(resolve, 800))
      .then(() => this.maybeRefresh(chatId))
      .catch(() => undefined);
  }

  forget(chatId: string): void {
    this.slots.delete(chatId);
  }

  private async maybeRefresh(chatId: string): Promise<void> {
    const prefs = this.deps.getRuntimePrefs?.() ?? null;
    const cfg = resolveChatTitleRefreshConfig(prefs);
    if (!cfg.enabled) return;

    const diskMeta = await readChatMetadata(chatId);
    if (!diskMeta || !chatTitleRefreshEligible(diskMeta)) return;

    const entries = await loadChatTranscriptFromSessionLog(chatId, { maxEntries: 120 });
    const userTurns = countUserTurns(entries);
    if (!shouldRefreshTitleAtTurn(userTurns, cfg)) return;

    const slot = this.slots.get(chatId) ?? {
      lastRefreshAt: 0,
      lastRefreshedTurn: 0,
      inFlight: false,
    };
    if (slot.inFlight) return;
    if (slot.lastRefreshedTurn === userTurns) return;

    const now = Date.now();
    if (slot.lastRefreshAt > 0 && now - slot.lastRefreshAt < cfg.minIntervalMs) return;

    const excerpt = buildChatTitleTranscriptExcerpt(entries, cfg.transcriptChars);
    if (!excerpt.trim()) return;

    slot.inFlight = true;
    this.slots.set(chatId, slot);

    try {
      const provider = resolveProviderConfig();
      if (!provider.apiKey?.trim()) return;

      const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
      const model = getFastModelSlug(provider.model);
      const jr = await completeChatJson(client, {
        model,
        messages: [
          { role: "system", content: TITLE_SYSTEM },
          {
            role: "user",
            content: `Name this chat from the recent transcript.\n\n${excerpt}`,
          },
        ],
        maxTokens: cfg.maxTokens,
        temperature: 0.2,
        signal: AbortSignal.timeout(cfg.timeoutMs),
        isFastModel: true,
      });
      if (!jr.ok) return;

      const title = normalizeGeneratedChatTitle(jr.parsed ?? jr.raw);
      if (!title) return;

      const written = await setChatTitle(chatId, title, { titleSource: "auto" });
      if (!written || written.title === diskMeta.title) return;

      slot.lastRefreshAt = now;
      slot.lastRefreshedTurn = userTurns;
      await this.deps.onTitleUpdated(chatId, written.title);
    } finally {
      slot.inFlight = false;
      this.slots.set(chatId, slot);
    }
  }
}
