/**
 * Cross-encoder-style rerank for recall candidates.
 *
 * BM25 + embedding fusion is a good first-stage retriever but a poor final
 * ranker: it surfaces topically-related-but-wrong notes near the top, which is
 * especially visible under cross-chat federation where many sibling-chat notes
 * share vocabulary with the query. This module adds a cheap second stage — a
 * single fast-model call that scores each shortlisted candidate's *actual*
 * relevance to the query (0–1), so the final ordering reflects judged relevance
 * rather than lexical/vector overlap alone.
 *
 * Gated by AGENT_RECALL_RERANK=1 (sidecar call, off by default). All failures
 * degrade gracefully: the caller keeps the first-stage ordering.
 */
import OpenAI from "openai";
import { completeChatJson, getFastModelSlug, effectiveHarnessEnvRaw } from "@liminal/core";

export interface RerankCandidate {
  id: string;
  text: string;
}

/** True when the reranker is enabled via env. */
export function rerankEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_RECALL_RERANK") === "1";
}

/** Blend weight for `finalScore = hybrid * (1 + weight * relevance)`. */
export function rerankWeight(): number {
  const raw = Number(effectiveHarnessEnvRaw("AGENT_RECALL_RERANK_WEIGHT") ?? "1.0");
  return Number.isFinite(raw) && raw >= 0 ? raw : 1.0;
}

/**
 * Parse a rerank model response into an id→relevance map (0–1), tolerant of the
 * common JSON shapes a model might emit. Only ids in `validIds` are kept, so a
 * hallucinated id can never inject a phantom candidate. Exported for unit tests.
 */
export function parseRerankScores(parsed: unknown, validIds: Set<string>): Map<string, number> {
  const out = new Map<string, number>();
  if (!parsed || typeof parsed !== "object") return out;
  const obj = parsed as Record<string, unknown>;
  // Accept {scores:[...]}, {results:[...]}, {ranking:[...]}, or a bare array.
  const arr =
    (Array.isArray(obj["scores"]) && (obj["scores"] as unknown[])) ||
    (Array.isArray(obj["results"]) && (obj["results"] as unknown[])) ||
    (Array.isArray(obj["ranking"]) && (obj["ranking"] as unknown[])) ||
    (Array.isArray(parsed) ? (parsed as unknown[]) : null);
  if (!arr) return out;
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = typeof rec["id"] === "string" ? rec["id"] : undefined;
    if (!id || !validIds.has(id)) continue;
    const rawScore = rec["relevance"] ?? rec["score"] ?? rec["rating"];
    let score = Number(rawScore);
    if (!Number.isFinite(score)) continue;
    // Tolerate 0–10 / 0–100 scales by normalizing anything > 1 down to 0–1.
    if (score > 1) score = score > 10 ? score / 100 : score / 10;
    out.set(id, Math.max(0, Math.min(1, score)));
  }
  return out;
}

/**
 * Score candidate relevance to `query` with one fast-model call. Returns an
 * id→relevance map (only judged ids), or null on any failure (caller falls back
 * to first-stage order). Caps the shortlist and truncates text to keep the
 * prompt small and the call fast.
 */
export async function rerankCandidates(
  query: string,
  candidates: RerankCandidate[],
  opts?: { maxCandidates?: number; timeoutMs?: number }
): Promise<Map<string, number> | null> {
  if (candidates.length === 0) return null;
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  if (!apiKey) return null;
  const baseURL = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  );
  const max = Math.max(1, Math.min(40, opts?.maxCandidates ?? 25));
  const shortlist = candidates.slice(0, max);

  // Wire candidates as 1-based integer labels, NOT their real ids. Models will
  // not faithfully echo arbitrary id strings (e.g. they drop the "note:" prefix
  // of "note:1" and return "1"), which would zero out the rerank. Small integers
  // round-trip reliably; we map the returned index back to the real id by
  // position. validLabels guards against hallucinated/out-of-range indices.
  const validLabels = new Set(shortlist.map((_, i) => String(i + 1)));

  const defaultModel = effectiveHarnessEnvRaw("AGENT_MODEL")?.trim() || "deepseek/deepseek-v4-pro";
  const model = getFastModelSlug(defaultModel);
  const client = new OpenAI({ apiKey, baseURL });

  const sys =
    "You are a retrieval reranker. Score how directly each candidate helps answer the QUERY.\n" +
    "Score 1.0 = directly answers/contains the needed fact; 0.5 = related context; 0.0 = irrelevant.\n" +
    'Return JSON only: {"scores":[{"id":"<number>","relevance":<0-1 number>}, ...]} using the [number] label of every candidate.';
  const list = shortlist
    .map((c, i) => `[${i + 1}] ${c.text.replace(/\s+/g, " ").slice(0, 220)}`)
    .join("\n");
  const user = `QUERY: ${query.slice(0, 500)}\n\nCANDIDATES:\n${list}`;

  const r = await completeChatJson(client, {
    model,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    maxTokens: Math.min(2000, 60 + shortlist.length * 24),
    temperature: 0,
    isFastModel: true,
    fallbackModel: defaultModel,
    signal: AbortSignal.timeout(opts?.timeoutMs ?? 7000),
  });
  if (!r.ok) return null;
  const byLabel = parseRerankScores(r.parsed, validLabels);
  if (byLabel.size === 0) return null;
  // Translate integer labels back to the real candidate ids by position.
  const byId = new Map<string, number>();
  for (const [label, score] of byLabel) {
    const idx = Number(label) - 1;
    const cand = shortlist[idx];
    if (cand) byId.set(cand.id, score);
  }
  return byId.size > 0 ? byId : null;
}
