/**
 * On-demand chat consolidation (shared by web idle hook and consolidate_chat tool).
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import OpenAI from "openai";
import { buildAutoDreamPrompt } from "./auto_dream.js";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw, resolveHarnessEnvRaw } from "./harness_effective_env.js";
import { globalChatsRoot, sanitizeChatId } from "./global_storage.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export interface ConsolidateUpsert {
  type?: string;
  key?: string;
  value?: string;
}

export interface ConsolidateSessionResult {
  ok: boolean;
  error?: string;
  summary?: string;
  upserts?: ConsolidateUpsert[];
  chatId?: string;
}

function sessionPath(chatId: string): string {
  return path.join(globalChatsRoot(), sanitizeChatId(chatId), "session.jsonl");
}

export function resolveConsolidateOnIdleConfig(prefs: RuntimePreferences | null = null): {
  enabled: boolean;
  minMessages: number;
} {
  const enabled = resolveHarnessEnvRaw("AGENT_CONSOLIDATE_ON_IDLE", prefs) !== "0";
  const raw = resolveHarnessEnvRaw("AGENT_CONSOLIDATE_MIN_MESSAGES", prefs)?.trim();
  const n = raw ? parseInt(raw, 10) : 8;
  const minMessages = Number.isFinite(n) ? Math.max(2, Math.min(200, n)) : 8;
  return { enabled, minMessages };
}

export async function loadSessionSnippet(
  chatId: string,
  maxChars = 12_000
): Promise<string | null> {
  try {
    const raw = await readFile(sessionPath(chatId), "utf8");
    const snippet = raw.slice(-maxChars).trim();
    return snippet.length > 0 ? snippet : null;
  } catch {
    return null;
  }
}

/**
 * Run fast-model consolidation for one chat session log tail.
 * Caller applies upserts (tools layer uses notes_store.atomicUpdate).
 */
export async function consolidateChatSession(input: {
  chatId: string;
  notesSnapshot: string;
  client: OpenAI;
  mainModel: string;
  maxChars?: number;
  prefs?: RuntimePreferences | null | undefined;
}): Promise<ConsolidateSessionResult> {
  const chatId = sanitizeChatId(input.chatId.trim());
  if (!chatId) return { ok: false, error: "empty chat id" };

  const maxChars = Math.min(60_000, Math.max(1000, input.maxChars ?? 12_000));
  const snippet = await loadSessionSnippet(chatId, maxChars);
  if (!snippet) return { ok: false, error: "session log missing or empty", chatId };

  const prompt = buildAutoDreamPrompt({
    notesSnapshot: input.notesSnapshot.slice(0, 8000),
    sessions: [{ sessionId: chatId, snippet }],
  });

  const fast = getFastModelSlug(input.mainModel);
  const timeoutRaw = resolveHarnessEnvRaw("AGENT_CONSOLIDATE_TIMEOUT_MS", input.prefs ?? null)?.trim();
  const timeoutMs = timeoutRaw
    ? Math.max(5_000, Math.min(120_000, parseInt(timeoutRaw, 10) || 30_000))
    : 30_000;

  try {
    const jr = await completeChatJson(input.client, {
      model: fast,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1200,
      temperature: 0.2,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!jr.ok || !jr.parsed || typeof jr.parsed !== "object") {
      return {
        ok: false,
        error: jr.ok ? "consolidation returned non-object JSON" : jr.error,
        chatId,
      };
    }
    const parsed = jr.parsed as {
      summary?: string;
      upserts?: ConsolidateUpsert[];
    };
    const upserts = (parsed.upserts ?? []).filter(
      (u) => u && typeof u.key === "string" && typeof u.value === "string"
    );
    return {
      ok: true,
      chatId,
      summary: parsed.summary?.slice(0, 2000),
      upserts,
    };
  } catch (e) {
    return {
      ok: false,
      error: `consolidation call failed: ${e instanceof Error ? e.message : String(e)}`,
      chatId,
    };
  }
}
