/**
 * consolidate_chat — on-demand memory consolidation for the current (or named) chat.
 *
 * Federation Phase 2. Where `auto_dream` runs as a 24h+ background pass across
 * multiple sessions, this tool is a callable for "this chat is wrapping up,
 * fold its learnings forward into long-term memory right now." Useful when the
 * user is finishing a long session and wants the takeaways preserved before
 * the per-chat session log eventually rolls off.
 *
 * Mechanics:
 *   1. Load the chat's session.jsonl tail.
 *   2. Pass it through the same fast-model JSON prompt auto_dream uses, but
 *      scoped to ONE session at a time so the prompt stays small.
 *   3. Apply upserts via atomicUpdate with the federation-aware default scope
 *      (identity-shaped keys → global, others → workspace).
 *   4. Return the summary + per-upsert list so the user can audit.
 *
 * Failure modes: missing session log, fast-model unreachable, JSON parse
 * failure — all surface as ok:false; no partial writes.
 */
import path from "node:path";
import { readFile } from "node:fs/promises";
import { defineTool } from "./helpers.js";
import {
  buildAutoDreamPrompt,
  completeChatJson,
  effectiveHarnessEnvRaw,
  getFastModelSlug,
  globalChatsRoot,
  resolveCurrentChatId,
  resolveProviderConfig,
  sanitizeChatId,
} from "@liminal/core";
import OpenAI from "openai";
import { atomicUpdate, loadNotes, makeTypedKey } from "./notes_store.js";

interface ConsolidateUpsert {
  type?: string;
  key?: string;
  value?: string;
}

interface ConsolidateParsed {
  summary?: string;
  upserts?: ConsolidateUpsert[];
  deletes?: Array<{ key?: string; reason?: string }>;
}

function sessionPath(chatId: string): string {
  return path.join(globalChatsRoot(), sanitizeChatId(chatId), "session.jsonl");
}

export const consolidateChatTool = defineTool({
  name: "consolidate_chat",
  description:
    "WHAT: Run an on-demand memory consolidation for one chat — extract durable insights from its session log " +
    "and write them as scoped notes.\n" +
    "WHEN: A chat is wrapping up, or you want this chat's learnings available in future conversations " +
    "without waiting for the 24h auto-dream cycle.\n" +
    "NOT WHEN: You're mid-task and just want recall — use recall_relevant.\n" +
    "ARGS: chat_id — defaults to the current chat. max_chars — cap on session log tail (default 12k).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      chat_id: { type: "string", description: "Chat id to consolidate. Defaults to the active chat." },
      max_chars: { type: "number", description: "Cap on session log tail (default 12000, max 60000)." },
    },
    required: [],
    additionalProperties: false,
  },
  handler: async (args) => {
    const chatId = sanitizeChatId(String(args["chat_id"] ?? resolveCurrentChatId() ?? "").trim());
    if (!chatId) return { ok: false, error: "no chat id (pass chat_id or run inside an active harness send)" };
    const maxChars = Math.min(60000, Math.max(1000, (args["max_chars"] as number | undefined) ?? 12000));

    let snippet = "";
    try {
      const raw = await readFile(sessionPath(chatId), "utf8");
      snippet = raw.slice(-maxChars).trim();
    } catch {
      return { ok: false, error: `no session log at ${sessionPath(chatId)}` };
    }
    if (!snippet) return { ok: false, error: "session log is empty — nothing to consolidate" };

    const notesSnapshot = JSON.stringify(await loadNotes()).slice(0, 8000);
    const prompt = buildAutoDreamPrompt({
      notesSnapshot,
      sessions: [{ sessionId: chatId, snippet }],
    });

    const provider = resolveProviderConfig();
    if (!provider.apiKey) return { ok: false, error: "provider API key missing" };
    const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL });
    const mainModel = provider.model;
    const fast = getFastModelSlug(mainModel);

    const consolidateTimeoutMsRaw = effectiveHarnessEnvRaw("AGENT_CONSOLIDATE_TIMEOUT_MS");
    const timeoutMs = consolidateTimeoutMsRaw ? Math.max(5_000, Math.min(120_000, parseInt(consolidateTimeoutMsRaw, 10))) : 30_000;

    let parsed: ConsolidateParsed;
    try {
      const jr = await completeChatJson(client, {
        model: fast,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 1200,
        temperature: 0.2,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!jr.ok || !jr.parsed || typeof jr.parsed !== "object") {
        return { ok: false, error: jr.ok ? "judge returned non-object JSON" : jr.error };
      }
      parsed = jr.parsed as ConsolidateParsed;
    } catch (e) {
      return { ok: false, error: `consolidation call failed: ${e instanceof Error ? e.message : String(e)}` };
    }

    const upserts = (parsed.upserts ?? []).filter((u) => u && typeof u.key === "string" && typeof u.value === "string");
    if (upserts.length === 0) {
      return {
        ok: true,
        output: `Consolidated chat ${chatId.slice(0, 8)} — no new durable insights.\nSummary: ${parsed.summary?.slice(0, 400) ?? "(none)"}`,
      };
    }

    const writtenLines: string[] = [];
    for (const u of upserts) {
      const storageKey = u.type ? makeTypedKey(u.type, u.key as string) : (u.key as string);
      const value = (u.value as string).slice(0, 4000);
      // Default scope picked by atomicUpdate's auto-classifier — identity-shaped
      // keys go global, everything else lands as workspace-scoped.
      await atomicUpdate((notes) => ({ ...notes, [storageKey]: value }), chatId);
      writtenLines.push(`  + ${storageKey}: ${value.slice(0, 80)}${value.length > 80 ? "…" : ""}`);
    }
    return {
      ok: true,
      output:
        `Consolidated chat ${chatId.slice(0, 8)} — wrote ${upserts.length} note(s).\n` +
        `Summary: ${(parsed.summary ?? "").slice(0, 400)}\n` +
        writtenLines.join("\n"),
    };
  },
});
