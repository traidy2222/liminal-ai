/**
 * Query decomposition + optional HyDE for hybrid retrieval (Phase 2).
 */
import type OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export interface RewriteQueryResult {
  subQueries: string[];
  hyde?: string;
}

function ruleBasedSubqueries(task: string): string[] {
  const t = task.trim().slice(0, 2000);
  const parts = t
    .split(/[;\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8);
  const out: string[] = [t.slice(0, 400)];
  for (const p of parts) {
    if (!out.includes(p) && p.length < 300) out.push(p);
    if (out.length >= 5) break;
  }
  return [...new Set(out)].slice(0, 5);
}

export async function rewriteQueryForRecall(
  task: string,
  client: OpenAI,
  defaultModel: string
): Promise<RewriteQueryResult> {
  const t = task.trim().slice(0, 4000);
  if (effectiveHarnessEnvRaw("AGENT_QUERY_REWRITE") !== "1") {
    return { subQueries: [t.slice(0, 800)] };
  }
  const fast = getFastModelSlug(defaultModel);
  const sys =
    "You help retrieve memories. Decompose the task into 1-5 short search queries (keywords + entities).\n" +
    "Optionally add \"hyde\": one short hypothetical paragraph (may be speculative) that would answer the task if true — used only for embedding search.\n" +
    'Return JSON: {"subQueries": string[], "hyde"?: string}';
  const r = await completeChatJson(client, {
    model: fast,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: t },
    ],
    maxTokens: 500,
    temperature: 0.15,
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok || typeof r.parsed !== "object" || r.parsed === null) {
    return { subQueries: ruleBasedSubqueries(t) };
  }
  const obj = r.parsed as Record<string, unknown>;
  const pq = obj["subQueries"];
  const hydeRaw = obj["hyde"];
  if (!Array.isArray(pq) || pq.length === 0) {
    return { subQueries: ruleBasedSubqueries(t) };
  }
  const subQueries = pq
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 5);
  const hyde =
    typeof hydeRaw === "string" && hydeRaw.trim() ? hydeRaw.trim().slice(0, 800) : undefined;
  return { subQueries: subQueries.length ? subQueries : ruleBasedSubqueries(t), hyde };
}

/**
 * Identity recall queries — always LLM-generated (not keyword lists).
 * Runs even when AGENT_QUERY_REWRITE=0.
 */
export async function rewriteQueryForIdentityRecall(
  userMessage: string,
  client: OpenAI,
  defaultModel: string
): Promise<RewriteQueryResult> {
  const msg = userMessage.trim().slice(0, 1200);
  if (!msg) return { subQueries: ["user preferred name how to address user"] };

  const r = await completeChatJson(client, {
    model: getFastModelSlug(defaultModel),
    messages: [
      {
        role: "system",
        content:
          "The user is asking about their name or identity. Generate 2–4 short memory search queries " +
          "that would find stored facts about what to call them (not OS usernames).\n" +
          'Return JSON: {"subQueries": string[], "hyde"?: string}\n' +
          "hyde: optional one-sentence hypothetical note that states their name if it were stored.",
      },
      { role: "user", content: msg },
    ],
    maxTokens: 280,
    temperature: 0.1,
    signal: AbortSignal.timeout(8000),
  });

  if (!r.ok || typeof r.parsed !== "object" || r.parsed === null) {
    return { subQueries: [msg.slice(0, 400)] };
  }
  const obj = r.parsed as Record<string, unknown>;
  const pq = obj["subQueries"];
  const hydeRaw = obj["hyde"];
  const subQueries = Array.isArray(pq)
    ? pq
        .map((x) => String(x).trim())
        .filter((s) => s.length >= 3)
        .slice(0, 5)
    : [];
  const hyde =
    typeof hydeRaw === "string" && hydeRaw.trim() ? hydeRaw.trim().slice(0, 600) : undefined;
  return {
    subQueries: subQueries.length > 0 ? subQueries : [msg.slice(0, 400)],
    hyde,
  };
}
