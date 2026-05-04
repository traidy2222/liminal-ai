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
  memoryType?: string;
  accessCount?: number;
  confidence?: number;
}

/**
 * Rank documents by BM25(query) + type + recency + trust. Returns top `limit` by score descending.
 */
export function rankDocumentsForQuery(
  query: string,
  docs: RankableDoc[],
  opts?: { limit?: number }
): Array<{ id: string; score: number; doc: RankableDoc }> {
  const queryTerms = tokenize(query);
  const limit = opts?.limit ?? 50;
  if (queryTerms.length === 0 || docs.length === 0) return [];

  const docTokenLists = docs.map((d) => tokenize(d.text));
  const df = buildDf(docTokenLists);
  const N = docs.length;
  const totalLen = docTokenLists.reduce((a, t) => a + Math.max(t.length, 1), 0);
  const avgdl = totalLen / N;

  const now = Date.now();
  const qLower = query.toLowerCase();

  const scored = docs.map((doc, i) => {
    const bm = bm25ForQuery(queryTerms, docTokenLists[i]!, df, N, avgdl);
    const sub =
      doc.text.toLowerCase().includes(qLower) && qLower.length >= 2 ? 0.25 : 0;
    const score =
      bm +
      sub +
      memoryTypeBoost(doc.memoryType) +
      recencyBoost(doc.updatedAt, now) +
      trustBoost(doc.accessCount, doc.confidence);
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
