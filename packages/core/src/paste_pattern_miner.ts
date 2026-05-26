/**
 * PASTE pattern miner.
 *
 * Scans session JSONL files under ~/.liminal/chats/<chatId>/session.jsonl and
 * the legacy `.agent_sessions/` directory, and mines empirical tool-sequence
 * patterns of the form:
 *
 *   context (last N tool names within a turn) → next tool, with probability
 *
 * Output is a flat PatternRecord array suitable for persistence and Top-k
 * lookup by context signature.
 *
 * Reference: PASTE (Pattern-Aware Speculative Tool Execution, arXiv:2603.18897).
 * Their reported pattern accuracy: 27.8% Top-1, 43.9% Top-3, 93.8% hit rate.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveWorkspaceRoot } from "./workspace_root.js";

/** Window of prior tool names used as the context key. */
export const DEFAULT_CONTEXT_WINDOW = 2;

/** Minimum observations of a (context, next) pair before it is kept. */
export const DEFAULT_MIN_SUPPORT = 3;

/** Tools that are never useful to speculate. Side-effecting / interactive / harness-meta. */
const SPECULATION_BLOCKLIST: ReadonlySet<string> = new Set([
  "write_file",
  "edit_file",
  "multi_file_apply",
  "move_file",
  "copy_file",
  "copy_tree",
  "mkdir_p",
  "rename_symbol",
  "run_shell",
  "run_background",
  "execute_code",
  "run_command_with_pty",
  "kill_process",
  "git_commit",
  "git_checkpoint",
  "git_rollback",
  "git_worktree",
  "vault_write",
  "vault_delete",
  "remember",
  "forget",
  "forget_type",
  "memory_consolidate",
  "set_persona",
  "set_runtime_settings",
  "append_persona_living",
  "ask_user",
  "spawn_agent",
  "browser_act",
  "captcha_solve",
  "api_connect",
  "api_disconnect",
  "mcp_attach",
  "mcp_detach",
  "schedule_create",
  "schedule_delete",
  "schedule_run",
  "create_tool",
  "edit_tool",
  "remove_tool",
]);

export function isSpeculatable(toolName: string): boolean {
  return !SPECULATION_BLOCKLIST.has(toolName);
}

interface SessionEvent {
  event?: string;
  turnIndex?: number;
  name?: string;
  ok?: boolean;
  args?: Record<string, unknown>;
}

interface ObservedCall {
  turnIndex: number;
  name: string;
  ok: boolean;
}

/** A mined pattern: "after seeing these tools in order, the next call is usually X." */
export interface PatternRecord {
  /** Comma-joined last-N tool names (e.g. "web_search,web_fetch"). */
  contextKey: string;
  /** Predicted next tool name. */
  nextTool: string;
  /** Empirical probability among matching contexts. 0–1. */
  probability: number;
  /** Number of observations the probability is based on (denominator). */
  support: number;
  /** Hit count (numerator) — how many times this exact (context, next) was seen. */
  hits: number;
  /** Last-seen ISO timestamp from the source files (for staleness pruning). */
  lastSeen: string;
}

export interface MineOptions {
  contextWindow?: number;
  minSupport?: number;
  /** Override session directory roots. Default: ~/.liminal/chats + workspace .agent_sessions. */
  roots?: string[];
}

/** Default session root discovery. */
export function defaultSessionRoots(): string[] {
  const roots: string[] = [];
  const home = os.homedir();
  if (home) roots.push(path.join(home, ".liminal", "chats"));
  try {
    roots.push(path.join(resolveWorkspaceRoot(), ".agent_sessions"));
  } catch {
    /* workspace not available — skip */
  }
  return roots;
}

/**
 * Walk a session root looking for session.jsonl (per-chat layout) or
 * <id>.jsonl (legacy workspace layout). Returns absolute paths.
 */
async function listSessionFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    return found;
  }
  for (const entry of entries) {
    const abs = path.join(root, entry);
    let st;
    try {
      st = await stat(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      const candidate = path.join(abs, "session.jsonl");
      try {
        const s2 = await stat(candidate);
        if (s2.isFile()) found.push(candidate);
      } catch {
        /* no session.jsonl in this chat dir */
      }
    } else if (st.isFile() && entry.endsWith(".jsonl")) {
      found.push(abs);
    }
  }
  return found;
}

/** Parse one JSONL file into successful tool_result events grouped by turn. */
async function parseSessionFile(file: string): Promise<{
  byTurn: Map<number, ObservedCall[]>;
  latestTs: string;
}> {
  const byTurn = new Map<number, ObservedCall[]>();
  let latestTs = "";
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { byTurn, latestTs };
  }
  const lines = raw.split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec: SessionEvent & { ts?: string };
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.ts && rec.ts > latestTs) latestTs = rec.ts;
    if (rec.event !== "tool_result") continue;
    if (typeof rec.turnIndex !== "number" || !rec.name) continue;
    if (rec.ok !== true) continue; // failed calls don't make good predictions
    const list = byTurn.get(rec.turnIndex) ?? [];
    list.push({ turnIndex: rec.turnIndex, name: rec.name, ok: true });
    byTurn.set(rec.turnIndex, list);
  }
  return { byTurn, latestTs };
}

/**
 * Mine patterns from all sessions under the given roots.
 *
 * Algorithm: for each turn, slide a window of size `contextWindow` and count
 * (context-suffix → next-tool) co-occurrences. Within-turn only, because
 * across-turn order isn't a useful predictor — the user might have asked
 * something totally different.
 */
export async function minePatternsFromSessions(
  opts: MineOptions = {}
): Promise<PatternRecord[]> {
  const contextWindow = Math.max(1, opts.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  const minSupport = Math.max(1, opts.minSupport ?? DEFAULT_MIN_SUPPORT);
  const roots = opts.roots ?? defaultSessionRoots();

  /** Map<contextKey, Map<nextTool, count>> */
  const cooccurrence = new Map<string, Map<string, number>>();
  /** Map<contextKey, totalCount> — denominator for probability. */
  const contextTotals = new Map<string, number>();
  /** Map<contextKey, latestTs> — for staleness. */
  const lastSeen = new Map<string, string>();

  for (const root of roots) {
    const files = await listSessionFiles(root);
    for (const file of files) {
      const { byTurn, latestTs } = await parseSessionFile(file);
      for (const calls of byTurn.values()) {
        if (calls.length < contextWindow + 1) continue;
        for (let i = contextWindow; i < calls.length; i++) {
          const ctx = calls
            .slice(i - contextWindow, i)
            .map((c) => c.name)
            .join(",");
          const next = calls[i]!.name;
          if (!isSpeculatable(next)) continue;
          const inner = cooccurrence.get(ctx) ?? new Map<string, number>();
          inner.set(next, (inner.get(next) ?? 0) + 1);
          cooccurrence.set(ctx, inner);
          contextTotals.set(ctx, (contextTotals.get(ctx) ?? 0) + 1);
          if (latestTs && (lastSeen.get(ctx) ?? "") < latestTs) {
            lastSeen.set(ctx, latestTs);
          }
        }
      }
    }
  }

  const out: PatternRecord[] = [];
  for (const [ctx, nexts] of cooccurrence) {
    const total = contextTotals.get(ctx) ?? 0;
    if (total < minSupport) continue;
    for (const [nextTool, hits] of nexts) {
      if (hits < 1) continue;
      out.push({
        contextKey: ctx,
        nextTool,
        probability: hits / total,
        support: total,
        hits,
        lastSeen: lastSeen.get(ctx) ?? "",
      });
    }
  }

  // Higher-probability records first; ties broken by support.
  out.sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability;
    return b.support - a.support;
  });
  return out;
}
