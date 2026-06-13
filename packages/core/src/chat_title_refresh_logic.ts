/**
 * Pure helpers for background chat title refresh (unit-tested without provider imports).
 */
import type { RuntimePreferences } from "./runtime_prefs.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { ReplayTranscriptEntry } from "./chat_session_replay.js";
import type { ChatKind, ChatTitleSource } from "./chat_metadata.js";

export interface ChatTitleRefreshConfig {
  enabled: boolean;
  minIntervalMs: number;
  minUserTurns: number;
  everyNTurns: number;
  maxTokens: number;
  timeoutMs: number;
  transcriptChars: number;
}

export function resolveChatTitleRefreshConfig(
  prefs: RuntimePreferences | null = null
): ChatTitleRefreshConfig {
  const enabled = resolveHarnessEnvRaw("AGENT_CHAT_TITLE", prefs)?.trim() !== "0";
  const minIntervalMs = clampInt(
    resolveHarnessEnvRaw("AGENT_CHAT_TITLE_MIN_INTERVAL_MS", prefs) ?? "60000",
    15_000,
    3_600_000,
    60_000
  );
  const minUserTurns = clampInt(
    resolveHarnessEnvRaw("AGENT_CHAT_TITLE_MIN_TURNS", prefs) ?? "1",
    1,
    20,
    1
  );
  const everyNTurns = clampInt(
    resolveHarnessEnvRaw("AGENT_CHAT_TITLE_EVERY_N_TURNS", prefs) ?? "1",
    1,
    20,
    1
  );
  const maxTokens = clampInt(
    resolveHarnessEnvRaw("AGENT_CHAT_TITLE_MAX_TOKENS", prefs) ?? "80",
    24,
    256,
    80
  );
  const timeoutMs = clampInt(
    resolveHarnessEnvRaw("AGENT_CHAT_TITLE_TIMEOUT_MS", prefs) ?? "20000",
    3_000,
    120_000,
    20_000
  );
  const transcriptChars = clampInt(
    resolveHarnessEnvRaw("AGENT_CHAT_TITLE_TRANSCRIPT_CHARS", prefs) ?? "4000",
    500,
    16_000,
    4000
  );
  return {
    enabled,
    minIntervalMs,
    minUserTurns,
    everyNTurns,
    maxTokens,
    timeoutMs,
    transcriptChars,
  };
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

export function countUserTurns(entries: ReplayTranscriptEntry[]): number {
  return entries.filter((e) => e.kind === "user" && e.text?.trim()).length;
}

export function shouldRefreshTitleAtTurn(
  userTurns: number,
  cfg: Pick<ChatTitleRefreshConfig, "minUserTurns" | "everyNTurns">
): boolean {
  if (userTurns < cfg.minUserTurns) return false;
  if (userTurns === cfg.minUserTurns) return true;
  const delta = userTurns - cfg.minUserTurns;
  return delta > 0 && delta % cfg.everyNTurns === 0;
}

export function buildChatTitleTranscriptExcerpt(
  entries: ReplayTranscriptEntry[],
  maxChars: number
): string {
  const lines: string[] = [];
  let used = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.kind === "error") continue;
    let line = "";
    if (e.kind === "user") {
      line = `User: ${e.text?.trim() ?? ""}`;
    } else if (e.kind === "assistant") {
      line = `Assistant: ${e.text?.trim() ?? ""}`;
    } else if (e.kind === "tool_call") {
      const name = e.toolName ?? "tool";
      const preview = (e.toolOutput ?? e.text ?? "").trim().slice(0, 160);
      line = preview ? `Tool ${name}: ${preview}` : `Tool ${name}`;
    }
    line = line.trim();
    if (!line) continue;
    const nextLen = line.length + (lines.length ? 1 : 0);
    if (used + nextLen > maxChars) break;
    lines.unshift(line);
    used += nextLen;
  }
  return lines.join("\n");
}

export function normalizeGeneratedChatTitle(raw: unknown): string | null {
  if (typeof raw === "string") {
    const t = raw.trim().replace(/\s+/g, " ");
    if (t.length >= 3 && t.length <= 120) return t;
    return null;
  }
  if (raw && typeof raw === "object" && "title" in raw) {
    return normalizeGeneratedChatTitle((raw as { title: unknown }).title);
  }
  return null;
}

export function chatTitleRefreshEligible(meta: {
  kind?: ChatKind;
  titleSource?: ChatTitleSource;
  title?: string;
}): boolean {
  if (meta.kind === "orchestrator") return false;
  if (meta.titleSource === "user") return false;
  const title = meta.title?.trim() ?? "";
  if (title.startsWith("[Worker]")) return false;
  return true;
}
