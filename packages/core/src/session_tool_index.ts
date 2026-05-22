/**
 * In-session tool output semantic index.
 *
 * Accumulates tool results for the current send() into a lightweight BM25 index.
 * Allows the model to query past tool outputs without re-issuing the original
 * tool call or scanning the full context window.
 *
 * Scoped to one send(); cleared automatically at turn end.
 * No disk persistence — entirely in-memory.
 *
 * Gate: always active when tool index is populated (no extra env gate needed;
 * the query_tool_outputs tool is what the model calls explicitly).
 */

import { tokenize, rankDocumentsForQuery, type RankableDoc } from "./memory_rank.js";

export interface ToolOutputEntry {
  callId: string;
  toolName: string;
  /** Stable args fingerprint for dedup. */
  argsKey: string;
  /** Full output text (potentially large). */
  output: string;
  /** ISO timestamp of execution. */
  at: string;
  ok: boolean;
}

export interface ToolOutputQueryResult {
  callId: string;
  toolName: string;
  excerpt: string;
  score: number;
}

const MAX_ENTRIES = 200;
const MAX_OUTPUT_PER_ENTRY = 16_000; // cap to avoid O(n²) BM25 on huge outputs
const EXCERPT_CHARS = 600;

export class SessionToolIndex {
  private entries: ToolOutputEntry[] = [];

  /** Add a tool result to the index. Call after successful dispatch. */
  add(entry: ToolOutputEntry): void {
    if (this.entries.length >= MAX_ENTRIES) {
      // Evict oldest entry
      this.entries.shift();
    }
    this.entries.push({
      ...entry,
      output: entry.output.slice(0, MAX_OUTPUT_PER_ENTRY),
    });
  }

  /** Query the index using BM25. Returns top-k results with excerpts. */
  query(queryText: string, topK = 5): ToolOutputQueryResult[] {
    if (!queryText.trim() || this.entries.length === 0) return [];

    const docs: RankableDoc[] = this.entries.map((e) => ({
      id: e.callId,
      text: `${e.toolName} ${e.argsKey} ${e.output}`,
    }));

    const ranked = rankDocumentsForQuery(queryText, docs, { limit: topK });

    return ranked.map((r) => {
      const entry = this.entries.find((e) => e.callId === r.id)!;
      const excerpt = extractExcerpt(entry.output, queryText, EXCERPT_CHARS);
      return {
        callId: entry.callId,
        toolName: entry.toolName,
        excerpt,
        score: r.score,
      };
    });
  }

  /** All tool names called this send (unique). */
  getToolNamesSummary(): string[] {
    return [...new Set(this.entries.map((e) => e.toolName))];
  }

  /** Count of indexed entries. */
  size(): number {
    return this.entries.length;
  }

  /** Clear all entries (call at turn end). */
  clear(): void {
    this.entries = [];
  }

  /** Find entries by tool name. */
  getByToolName(name: string): ToolOutputEntry[] {
    return this.entries.filter((e) => e.toolName === name);
  }

  /** Most recent entry for a given tool name. */
  getLatest(toolName: string): ToolOutputEntry | null {
    const matches = this.entries.filter((e) => e.toolName === toolName);
    return matches.length > 0 ? matches[matches.length - 1]! : null;
  }

  /**
   * Find a prior successful entry with the same tool name + args fingerprint.
   * Used to flag duplicate tool calls so the model reuses the earlier result
   * instead of re-running identical work across rounds.
   */
  findPriorCall(
    toolName: string,
    argsKey: string,
    excludeCallId: string
  ): ToolOutputEntry | null {
    for (const e of this.entries) {
      if (e.callId === excludeCallId) continue;
      if (e.ok && e.toolName === toolName && e.argsKey === argsKey) return e;
    }
    return null;
  }
}

/**
 * Extract an excerpt from text that best covers the query terms.
 * Finds the highest-density window of EXCERPT_CHARS around query term occurrences.
 */
function extractExcerpt(text: string, query: string, maxChars: number): string {
  if (text.length <= maxChars) return text;

  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return text.slice(0, maxChars) + "…";

  const lower = text.toLowerCase();
  let bestStart = 0;
  let bestHits = 0;

  // Slide a window of maxChars, count query token hits
  const step = Math.max(1, Math.floor(maxChars / 4));
  for (let start = 0; start < text.length - maxChars; start += step) {
    const window = lower.slice(start, start + maxChars);
    const hits = queryTokens.filter((t) => window.includes(t)).length;
    if (hits > bestHits) {
      bestHits = hits;
      bestStart = start;
    }
  }

  const excerpt = text.slice(bestStart, bestStart + maxChars);
  const prefix = bestStart > 0 ? "…" : "";
  const suffix = bestStart + maxChars < text.length ? "…" : "";
  return prefix + excerpt + suffix;
}
