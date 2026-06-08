/**
 * BM25-lite + recency + type boosts for agent notes and vault snippets.
 * Pure functions — safe to call from world_context (no tools import).
 */

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function invDocFreq(term: string, df: Map<string, number>, N: number): number {
  const d = df.get(term) ?? 0;
  return Math.log(1 + (N - d + 0.5) / (d + 0.5));
}

function termFreqs(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

function buildDf(docs: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const toks of docs) {
    const seen = new Set(toks);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return df;
}

function bm25ForDoc(
  queryTerms: string[],
  docTokens: string[],
  df: Map<string, number>,
  N: number,
  avgdl: number
): number {
  const dl = Math.max(docTokens.length, 1);
  const tf = termFreqs(docTokens);
  const k1 = 1.5;
  const b = 0.75;
  let s = 0;
  for (const q of queryTerms) {
    const f = tf.get(q) ?? 0;
    if (f === 0) continue;
    const idf = invDocFreq(q, df, N);
    s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * dl) / avgdl));
  }
  return s;
}

export function memoryTypeBoost(memoryType: string | undefined): number {
  switch (memoryType) {
    case "trajectory":
      return 0.22; // full episodic replay — highest utility for few-shot recall
    case "fact":
      return 0.15;
    case "entity":
      return 0.12;
    case "experience":
      return 0.08;
    case "reflection":
      return 0.05;
    case "recipe":
      return 0.05;
    default:
      return 0;
  }
}

export function recencyBoost(iso: string | undefined, nowMs: number): number {
  if (!iso) return 0.05;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return 0.05;
  const days = Math.max(0, (nowMs - t) / (86400 * 1000));
  return 0.12 / (1 + days / 90);
}

/**
 * Spaced repetition decay score — penalises notes that have not been accessed recently.
 * Uses an exponential decay with configurable half-life (default: 30 days).
 * Notes accessed recently resist decay regardless of creation date.
 *
 * Returns a multiplier in [0.25, 1.0]:
 *   - 1.0 for notes accessed within 7 days
 *   - 0.5 at ~30 days without access (half-life)
 *   - 0.25 floor to prevent total suppression of old-but-valid facts
 */
export function spacedRepetitionDecay(opts: {
  lastAccessedAt?: string;
  accessCount?: number;
  confidence?: number;
  halfLifeDays?: number;
  nowMs?: number;
}): number {
  const now = opts.nowMs ?? Date.now();
  const halfLife = Math.max(1, opts.halfLifeDays ?? 30);
  const floor = 0.25;
  const ceiling = 1.0;

  // Notes with high access counts resist decay (they've been proven useful).
  const accessCount = Math.min(opts.accessCount ?? 0, 50);
  const accessResistance = Math.min(0.4, accessCount * 0.008); // up to +0.4 resistance

  if (!opts.lastAccessedAt) {
    // Never accessed — decay is moderate; confidence lifts it somewhat.
    const confLift = (opts.confidence ?? 0.5) * 0.15;
    return Math.max(floor, 0.55 + confLift + accessResistance);
  }

  const t = new Date(opts.lastAccessedAt).getTime();
  if (Number.isNaN(t)) return 0.6;

  const daysSinceAccess = Math.max(0, (now - t) / 86_400_000);
  const decayed = Math.pow(0.5, daysSinceAccess / halfLife);
  const adjusted = Math.min(ceiling, decayed + accessResistance);
  return Math.max(floor, adjusted);
}

/** Optional trust signal from StoredNote (Phase 2). */
export function trustBoost(accessCount?: number, confidence?: number): number {
  const c = confidence ?? 0.5;
  const n = Math.min(accessCount ?? 0, 20);
  return 0.07 * c + 0.001 * n;
}

export interface RankableDoc {
  id: string;
  text: string;
  updatedAt?: string;
  /** ISO timestamp of last retrieval — used for spaced repetition decay. */
  lastAccessedAt?: string;
  memoryType?: string;
  accessCount?: number;
  confidence?: number;
  /**
   * Workspace fingerprint the note was written in (set by notes_store).
   * Format: `git:<host>/<owner>/<repo>` for git checkouts, else `path:<abs>`.
   * Enables the workspace-affinity boost below.
   */
  workspaceFingerprint?: string;
  /** Chat / harness taskId that wrote the note (federation Phase 2). */
  chatId?: string;
  /** Visibility scope across chats; "chat" notes get a hard filter to their writer. */
  scope?: "chat" | "workspace" | "global";
}

/**
 * Small additive boost applied when a candidate note shares a workspace
 * fingerprint with the current workspace. Cross-workspace notes still surface
 * (especially when BM25 is very strong) — they just sit slightly behind their
 * same-workspace siblings, which is the right ordering when you're working
 * in a specific project but might still want to see related learnings from
 * adjacent ones.
 */
export function workspaceAffinityBoost(
  noteWs: string | undefined,
  currentWs: string | undefined
): number {
  if (!noteWs || !currentWs) return 0;
  return noteWs === currentWs ? 0.18 : 0;
}

/**
 * Federation Phase 2 — multiplicative penalty applied when a note comes from a
 * sibling chat in the same workspace. Sibling notes stay visible (the agent
 * may legitimately want continuity across chats), but rank behind the current
 * chat's own writes so the active conversation's train of thought wins ties.
 *
 * Cross-workspace global facts are not penalized — they're durable identity
 * facts the user expects to surface everywhere. Chat-scope notes from other
 * chats are filtered out earlier (hard scope filter).
 *
 * The default 0.85 is env-tunable via `AGENT_RECALL_SIBLING_DISCOUNT`.
 */
export function chatScopeMultiplier(opts: {
  noteScope: RankableDoc["scope"];
  noteChatId: string | undefined;
  noteWorkspaceFp: string | undefined;
  currentChatId: string | undefined;
  currentWorkspaceFp: string | undefined;
  siblingDiscount: number;
}): number {
  if (!opts.currentChatId) return 1; // recall without chat context (eval, CLI) — no penalty
  if (opts.noteChatId === undefined) return 1; // legacy notes (no chatId) — treat as global, no penalty
  if (opts.noteChatId === opts.currentChatId) return 1; // own chat — no penalty
  // Different chat. Only penalize when both notes share the current workspace
  // AND the note's scope is "workspace" (or unset → legacy global). "global"
  // scope notes stay unpenalized: they were explicitly marked durable.
  const sameWs =
    opts.currentWorkspaceFp && opts.noteWorkspaceFp && opts.currentWorkspaceFp === opts.noteWorkspaceFp;
  if (sameWs && opts.noteScope !== "global") {
    return Math.max(0.1, Math.min(1, opts.siblingDiscount));
  }
  return 1;
}

/**
 * Rank documents by BM25(query) + type + recency + trust. Returns top `limit` by score descending.
 */
export function rankDocumentsForQuery(
  query: string,
  docs: RankableDoc[],
  opts?: {
    limit?: number;
    /**
     * Workspace fingerprint of the caller (current workspace). When provided,
     * notes with a matching fingerprint get a small additive boost so memory
     * from "this project" surfaces ahead of cross-project candidates without
     * suppressing them entirely.
     */
    currentWorkspaceFingerprint?: string;
    /**
     * When true, drop any candidate whose workspaceFingerprint doesn't match
     * `currentWorkspaceFingerprint`. Used by the `recall_in_workspace` tool
     * for strict-scope recall.
     */
    requireWorkspaceMatch?: boolean;
    /**
     * Federation Phase 2 — chatId of the caller. Used to (a) enforce the hard
     * scope filter for `scope: "chat"` notes (only their own chat sees them)
     * and (b) apply the sibling-chat discount to same-workspace notes from
     * different chats.
     */
    currentChatId?: string;
    /**
     * Multiplicative penalty for sibling-chat notes (default 0.85). Lower
     * favors the current chat more; higher makes siblings co-equal.
     */
    siblingDiscount?: number;
    /**
     * When true, drop any candidate whose scope is "global" — used when the
     * caller wants to ignore cross-chat federation entirely (privacy-sensitive
     * turns). When false (default), all scopes are visible after their
     * respective penalties.
     */
    globalOnly?: boolean;
  }
): Array<{ id: string; score: number; doc: RankableDoc }> {
  const queryTerms = tokenize(query);
  const limit = opts?.limit ?? 50;
  if (queryTerms.length === 0 || docs.length === 0) return [];

  let effectiveDocs = docs;
  if (opts?.requireWorkspaceMatch && opts.currentWorkspaceFingerprint) {
    effectiveDocs = effectiveDocs.filter((d) => d.workspaceFingerprint === opts.currentWorkspaceFingerprint);
  }
  // Hard scope filter — chat-scope notes only visible to their own writer.
  if (opts?.currentChatId !== undefined) {
    effectiveDocs = effectiveDocs.filter(
      (d) => d.scope !== "chat" || d.chatId === opts.currentChatId
    );
  } else {
    // No chat context — be conservative and hide chat-scope notes entirely.
    effectiveDocs = effectiveDocs.filter((d) => d.scope !== "chat");
  }
  if (opts?.globalOnly) {
    effectiveDocs = effectiveDocs.filter((d) => d.scope === "global");
  }
  if (effectiveDocs.length === 0) return [];

  const docTokenLists = effectiveDocs.map((d) => tokenize(d.text));
  const df = buildDf(docTokenLists);
  const N = effectiveDocs.length;
  const totalLen = docTokenLists.reduce((a, t) => a + Math.max(t.length, 1), 0);
  const avgdl = totalLen / N;

  const now = Date.now();
  const qLower = query.toLowerCase();

  const scored = effectiveDocs.map((doc, i) => {
    const bm = bm25ForQuery(queryTerms, docTokenLists[i]!, df, N, avgdl);
    const sub =
      doc.text.toLowerCase().includes(qLower) && qLower.length >= 2 ? 0.25 : 0;
    const decay = spacedRepetitionDecay({
      lastAccessedAt: doc.lastAccessedAt,
      accessCount: doc.accessCount,
      confidence: doc.confidence,
      nowMs: now,
    });
    const rawScore =
      bm +
      sub +
      memoryTypeBoost(doc.memoryType) +
      recencyBoost(doc.updatedAt, now) +
      trustBoost(doc.accessCount, doc.confidence) +
      workspaceAffinityBoost(doc.workspaceFingerprint, opts?.currentWorkspaceFingerprint);
    const chatMul = chatScopeMultiplier({
      noteScope: doc.scope,
      noteChatId: doc.chatId,
      noteWorkspaceFp: doc.workspaceFingerprint,
      currentChatId: opts?.currentChatId,
      currentWorkspaceFp: opts?.currentWorkspaceFingerprint,
      siblingDiscount: opts?.siblingDiscount ?? 0.85,
    });
    const score = rawScore * decay * chatMul;
    return { id: doc.id, score, doc };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.filter((x) => x.score > 0).slice(0, limit);
}

function bm25ForQuery(
  queryTerms: string[],
  docTokens: string[],
  df: Map<string, number>,
  N: number,
  avgdl: number
): number {
  if (queryTerms.length === 0) return 0;
  return bm25ForDoc(queryTerms, docTokens, df, N, avgdl);
}

// ─── Semantic dream gating ────────────────────────────────────────────────────

/**
 * Score a turn message against a set of notes using BM25.
 * Returns a normalized [0, 1] score. Used to gate auto-recall:
 * if score < AGENT_DREAM_THRESHOLD, skip the recall call.
 */
export function scoreTurnAgainstIndex(turn: string, docs: RankableDoc[]): number {
  if (!turn.trim() || docs.length === 0) return 0;
  const queryTerms = tokenize(turn);
  if (queryTerms.length === 0) return 0;

  const docTokenLists = docs.map((d) => tokenize(d.text));
  const df = buildDf(docTokenLists);
  const N = docs.length;
  const totalLen = docTokenLists.reduce((a, t) => a + Math.max(t.length, 1), 0);
  const avgdl = totalLen / N;

  let maxScore = 0;
  for (const docTokens of docTokenLists) {
    const s = bm25ForDoc(queryTerms, docTokens, df, N, avgdl);
    if (s > maxScore) maxScore = s;
  }

  // Normalize: BM25 scores are unbounded but typically < 20 in practice.
  // Divide by a soft ceiling so the result lands in [0, 1].
  return Math.min(1, maxScore / 12);
}

// ─── Recall output parsing ────────────────────────────────────────────────────

const RECALL_NOTE_LINE_RE = /^-\s+\[([^\]]+)\]\s+score=/;

/**
 * Parse recall_relevant / memory_query note blocks into keyed entries for
 * contradiction detection and auto-resolve.
 */
export function parseRecalledNoteBlocks(output: string): Array<{ key?: string; text: string }> {
  const trimmed = output.trim();
  if (!trimmed) return [];

  const notes: Array<{ key?: string; text: string }> = [];
  for (const line of trimmed.split("\n")) {
    const m = RECALL_NOTE_LINE_RE.exec(line.trim());
    if (!m) continue;
    const key = m[1];
    const text = line.trim();
    if (text.length < 10) continue;
    notes.push({ key, text });
  }

  if (notes.length > 0) return notes;

  // Legacy multi-block format (blocks separated by ---)
  const blocks = trimmed.includes("\n---\n")
    ? trimmed.split("\n---\n").map((s) => s.trim())
    : [trimmed];
  for (const block of blocks) {
    if (block.length < 10) continue;
    let key: string | undefined;
    for (const line of block.split("\n")) {
      const m = RECALL_NOTE_LINE_RE.exec(line.trim());
      if (m) {
        key = m[1];
        break;
      }
    }
    notes.push({ key, text: block });
  }
  return notes;
}

// ─── Contradiction detection ──────────────────────────────────────────────────

export interface Contradiction {
  noteKey?: string;
  staleClaim: string;
  freshFact: string;
  confidence: number;
}

/** Extract number-like values from a string (port numbers, counts, booleans, etc.). */
function extractScalarValues(s: string): string[] {
  const nums = s.match(/\b\d{1,6}\b/g) ?? [];
  const bools = s.match(/\b(true|false|yes|no|on|off|enabled|disabled)\b/gi) ?? [];
  return [...nums, ...bools.map((b) => b.toLowerCase())];
}

/**
 * Compare a stored note against recent tool output strings.
 * Returns a contradiction if a shared entity appears with a different value.
 */
export function detectContradictions(
  recalled: Array<{ key?: string; text: string }>,
  toolOutputs: string[],
  opts?: { confidenceThreshold?: number }
): Contradiction[] {
  if (recalled.length === 0 || toolOutputs.length === 0) return [];
  const threshold = opts?.confidenceThreshold ?? 0;
  const contradictions: Contradiction[] = [];

  for (const note of recalled) {
    const noteTokens = tokenize(note.text);
    if (noteTokens.length === 0) continue;
    const noteValues = extractScalarValues(note.text);
    if (noteValues.length === 0) continue;

    for (const output of toolOutputs) {
      const outputValues = extractScalarValues(output);
      if (outputValues.length === 0) continue;

      // Check whether note and tool output share keywords (entity proximity)
      const outputTokens = tokenize(output);
      const sharedTokens = noteTokens.filter((t) => outputTokens.includes(t));
      if (sharedTokens.length < 2) continue;

      // Look for overlapping entity names but differing scalar values
      for (const nVal of noteValues) {
        if (outputValues.includes(nVal)) continue; // same value — no contradiction
        // Find a conflicting value in the output that's near a shared entity token
        for (const oVal of outputValues) {
          if (nVal === oVal) continue;
          // Ensure the differing values are of the same semantic type (both numbers or both bools)
          const nIsNum = /^\d+$/.test(nVal);
          const oIsNum = /^\d+$/.test(oVal);
          if (nIsNum !== oIsNum) continue;

          // Confidence: boosted by number of shared entity tokens
          const confidence = Math.min(0.95, 0.5 + sharedTokens.length * 0.08);
          if (confidence < threshold) continue;

          // Produce a concise fresh fact from the tool output context around the value
          const idx = output.indexOf(oVal);
          const ctx = output.slice(Math.max(0, idx - 60), idx + oVal.length + 60).trim();

          contradictions.push({
            noteKey: note.key,
            staleClaim: `${sharedTokens.slice(0, 3).join(" ")} = ${nVal}`,
            freshFact: ctx.slice(0, 200),
            confidence,
          });
          break; // one contradiction per note per output is enough
        }
        if (contradictions.some((c) => c.noteKey === note.key)) break;
      }
    }
  }

  return contradictions;
}
