/**
 * Unified memory priming — same federation-aware ranking as recall_relevant.
 */
import { readFile } from "node:fs/promises";
import {
  rankDocumentsForQuery,
  chatScopeMultiplier,
  type RankableDoc,
} from "./memory_rank.js";
import { notesPaths, pickReadPath, workspaceFingerprint } from "./global_storage.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

type RawNote =
  | string
  | {
      value?: string;
      updatedAt?: string;
      createdAt?: string;
      accessCount?: number;
      confidence?: number;
      scope?: "chat" | "workspace" | "global";
      chatId?: string;
      workspaceFingerprint?: string;
    };

function noteValue(raw: RawNote): string {
  return typeof raw === "string" ? raw : String(raw?.value ?? "");
}

function noteField<T>(raw: RawNote, key: keyof Exclude<RawNote, string>): T | undefined {
  if (typeof raw === "string") return undefined;
  return raw[key] as T | undefined;
}

function provenanceLabel(
  doc: RankableDoc,
  currentChatId: string | undefined,
  currentWs: string | undefined
): string {
  const scope = doc.scope ?? "workspace";
  if (scope === "global") return "(global)";
  if (!currentChatId || !doc.chatId) return "(workspace)";
  if (doc.chatId === currentChatId) return "(own chat)";
  if (currentWs && doc.workspaceFingerprint === currentWs) {
    return `(sibling chat ${doc.chatId.slice(0, 8)})`;
  }
  return "(workspace)";
}

export interface MemoryPrimingOptions {
  query: string;
  limit?: number;
  workspaceRoot?: string;
  currentChatId?: string;
  workspaceScope?: "current" | "all" | "global_only";
}

/**
 * Rank notes from the global notes file with the same scope filters as recall_relevant.
 */
export async function rankNotesForPriming(opts: MemoryPrimingOptions): Promise<string[]> {
  const trimmed = opts.query.trim();
  if (trimmed.length < 2) return [];

  const wsRoot = opts.workspaceRoot ?? resolveWorkspaceRoot();
  const currentWs = workspaceFingerprint(wsRoot);
  const currentChatId = opts.currentChatId;
  const limit = Math.max(1, Math.min(24, opts.limit ?? 6));
  const globalOnly = opts.workspaceScope === "global_only";

  let raw: string;
  try {
    const notesFile = await pickReadPath(notesPaths(wsRoot));
    raw = await readFile(notesFile, "utf8");
  } catch {
    return [];
  }

  let parsed: Record<string, RawNote>;
  try {
    parsed = JSON.parse(raw) as Record<string, RawNote>;
  } catch {
    return [];
  }

  const siblingDiscount = (() => {
    const rawDisc = effectiveHarnessEnvRaw("AGENT_RECALL_SIBLING_DISCOUNT")?.trim();
    const n = rawDisc ? parseFloat(rawDisc) : 0.85;
    return Number.isFinite(n) ? n : 0.85;
  })();

  const docs: RankableDoc[] = [];
  for (const [fullKey, entry] of Object.entries(parsed)) {
    const scope = noteField<RankableDoc["scope"]>(entry, "scope") ?? "workspace";
    if (globalOnly && scope !== "global") continue;
    if (scope === "chat" && currentChatId && noteField(entry, "chatId") !== currentChatId) {
      continue;
    }
    const colonIdx = fullKey.indexOf(":");
    const memType = colonIdx > 0 ? fullKey.slice(0, colonIdx) : undefined;
    docs.push({
      id: fullKey,
      text: `${fullKey} ${noteValue(entry)}`,
      updatedAt: noteField(entry, "updatedAt") ?? noteField(entry, "createdAt"),
      lastAccessedAt: noteField(entry, "updatedAt"),
      memoryType: memType,
      accessCount: noteField(entry, "accessCount"),
      confidence: noteField(entry, "confidence"),
      workspaceFingerprint: noteField(entry, "workspaceFingerprint"),
      chatId: noteField(entry, "chatId"),
      scope,
    });
  }

  const ranked = rankDocumentsForQuery(trimmed, docs, {
    limit: limit * 3,
    currentWorkspaceFingerprint: opts.workspaceScope === "current" ? currentWs : currentWs,
    currentChatId,
    globalOnly,
  });

  const lines: string[] = [];
  for (const hit of ranked.slice(0, limit)) {
    const doc = docs.find((d) => d.id === hit.id);
    if (!doc) continue;
    const mult = chatScopeMultiplier({
      noteScope: doc.scope,
      noteChatId: doc.chatId,
      noteWorkspaceFp: doc.workspaceFingerprint,
      currentChatId,
      currentWorkspaceFp: currentWs,
      siblingDiscount,
    });
    if (mult < 0.15) continue;
    const prov = provenanceLabel(doc, currentChatId, currentWs);
    const value = noteValue(parsed[hit.id] ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
    if (!value) continue;
    lines.push(`- [${hit.id}] ${value} ${prov}`);
  }
  return lines;
}
