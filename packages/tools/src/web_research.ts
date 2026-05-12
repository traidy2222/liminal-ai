/**
 * Orchestrates web_search → web_fetch → tier-aware multi-source synthesis.
 *
 * Sources are scored on a 4-tier credibility scale before synthesis.
 * The synthesis LLM is instructed to surface inter-tier contradictions and
 * flag claims that rest only on low-tier sources.
 */
import { defineTool } from "./helpers.js";
import { runHtmlDdgSearch } from "./web_search.js";
import { runWebFetch } from "./web_fetch.js";
import { fetchWithRetry } from "./network_retry.js";
import { withProviderRequestSpacing } from "@liminal/core";

// ─── Source credibility tiers ────────────────────────────────────────────────

/** 1 = highest trust, 4 = lowest. */
export type SourceTier = 1 | 2 | 3 | 4;

export const SOURCE_TIER_LABELS: Record<SourceTier, string> = {
  1: "T1-Authoritative",
  2: "T2-Quality",
  3: "T3-Aggregator",
  4: "T4-Unverified",
};

const TIER1_DOMAINS = new Set([
  // Wire services / major financial press
  "reuters.com", "apnews.com", "afp.com", "bloomberg.com",
  "ft.com", "wsj.com", "economist.com", "barrons.com",
  // Established newspapers / broadcasters
  "nytimes.com", "theguardian.com", "washingtonpost.com",
  "bbc.com", "bbc.co.uk", "npr.org", "abc.net.au", "smh.com.au",
  // Intergovernmental / standards bodies
  "un.org", "imf.org", "worldbank.org", "nato.int", "who.int",
  "icrc.org", "iaea.org", "oecd.org", "wto.org", "itu.int",
  // Academic / science publishers
  "nature.com", "science.org", "sciencedirect.com", "cell.com",
  "pubmed.ncbi.nlm.nih.gov", "ncbi.nlm.nih.gov", "jstor.org",
  "thelancet.com", "bmj.com", "nejm.org",
  // Tech: official docs / standards
  "developer.mozilla.org", "docs.python.org", "docs.microsoft.com",
  "learn.microsoft.com", "developer.apple.com", "developer.android.com",
  "tc39.es", "w3.org", "ietf.org", "iso.org",
  // Policy / research institutions (domain-agnostic)
  "rand.org", "brookings.edu", "cfr.org",
  "pewresearch.org", "ourworldindata.org",
]);

const TIER2_DOMAINS = new Set([
  // Quality press / analysis
  "theatlantic.com", "politico.com", "axios.com", "time.com", "newsweek.com",
  "cnn.com", "nbcnews.com", "cbsnews.com", "abcnews.go.com",
  "aljazeera.com", "dw.com", "france24.com", "rferl.org",
  "foreignaffairs.com", "foreignpolicy.com",
  // Tech / science journalism
  "arstechnica.com", "wired.com", "techcrunch.com", "thenextweb.com",
  "spectrum.ieee.org", "newscientist.com", "scientificamerican.com",
  // Business / finance
  "hbr.org", "mckinsey.com", "deloitte.com",
  // Health / medical journalism
  "healthline.com", "webmd.com", "mayoclinic.org",
  // Data / statistics
  "statista.com", "census.gov",
  // Legal / regulatory
  "law.cornell.edu", "regulations.gov",
  // Developer community (established)
  "stackoverflow.com", "github.com", "npmjs.com", "pypi.org",
]);

/** Score a URL's domain and return its credibility tier. */
export function scoreSourceDomain(url: string): SourceTier {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return 4;
  }
  // .gov and .mil are authoritative by TLD
  if (hostname.endsWith(".gov") || hostname.endsWith(".mil")) return 1;
  // .edu — treat as T2 (quality but may be student/personal pages)
  if (hostname.endsWith(".edu")) return 2;
  if (TIER1_DOMAINS.has(hostname)) return 1;
  if (TIER2_DOMAINS.has(hostname)) return 2;
  if (hostname === "wikipedia.org" || hostname.endsWith(".wikipedia.org")) return 3;
  if (hostname.endsWith(".substack.com") || hostname.endsWith(".medium.com")) return 3;
  if (["reddit.com", "twitter.com", "x.com", "facebook.com"].includes(hostname)) return 4;
  // Unknown domain
  return 3;
}

// ─── Tier-aware synthesis ────────────────────────────────────────────────────

interface ScoredSource {
  url: string;
  title: string;
  excerpt: string;
  tier: SourceTier;
  tierLabel: string;
}

interface RerankDecision {
  url: string;
  keep: boolean;
  relevance: number;
  novelty: number;
  rationale?: string;
}

interface EvidenceTuple {
  claim: string;
  evidence_quote: string;
  source_url: string;
  confidence: "high" | "med" | "low";
  is_time_sensitive: boolean;
}

interface SynthesisPayload {
  answer: string;
  key_findings: string[];
  contradictions: string[];
  uncertain_claims: string[];
  evidence_table: Array<{
    claim: string;
    source_urls: string[];
    quotes: string[];
  }>;
  confidence: "high" | "med" | "low";
}

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function envMs(name: string, fallback: number): number {
  return envInt(name, fallback, 3000, 120_000);
}

function getWebResearchConfig() {
  const targetKDefault = envInt("AGENT_WEB_RESEARCH_K_DEFAULT", 4, 1, 8);
  const fetchMultiplier = envInt("AGENT_WEB_RESEARCH_FETCH_MULTIPLIER", 2, 1, 4);
  return {
    plannerQueriesMax: envInt("AGENT_WEB_RESEARCH_PLANNER_QUERIES_MAX", 4, 1, 8),
    plannerQueryMaxChars: envInt("AGENT_WEB_RESEARCH_PLANNER_QUERY_MAX_CHARS", 140, 40, 300),
    fetchMultiplier,
    fetchPerQueryCap: envInt("AGENT_WEB_RESEARCH_FETCH_PER_QUERY_CAP", targetKDefault + 4, 2, 16),
    excerptMaxChars: envInt("AGENT_WEB_RESEARCH_EXCERPT_MAX_CHARS", 4000, 800, 8000),
    rerankPoolMax: envInt("AGENT_WEB_RESEARCH_RERANK_POOL_MAX", targetKDefault * fetchMultiplier + 4, 2, 32),
    evidenceSourcesMax: envInt("AGENT_WEB_RESEARCH_EVIDENCE_SOURCES_MAX", 4, 1, 8),
    evidencePerSourceMax: envInt("AGENT_WEB_RESEARCH_EVIDENCE_PER_SOURCE_MAX", 4, 1, 12),
    evidenceQuoteMaxChars: envInt("AGENT_WEB_RESEARCH_EVIDENCE_QUOTE_MAX_CHARS", 260, 80, 600),
    finalOutputMaxChars: envInt("AGENT_WEB_RESEARCH_FINAL_MAX_CHARS", 28_000, 4000, 60_000),
    llmTimeoutMs: envMs("AGENT_WEB_RESEARCH_LLM_TIMEOUT_MS", 25_000),
    plannerTimeoutMs: envMs("AGENT_WEB_RESEARCH_PLANNER_TIMEOUT_MS", 15_000),
    rerankTimeoutMs: envMs("AGENT_WEB_RESEARCH_RERANK_TIMEOUT_MS", 20_000),
    evidenceTimeoutMs: envMs("AGENT_WEB_RESEARCH_EVIDENCE_TIMEOUT_MS", 18_000),
    synthesisTimeoutMs: envMs("AGENT_WEB_RESEARCH_SYNTHESIS_TIMEOUT_MS", 25_000),
  };
}

function coerceConfidence(v: unknown): "high" | "med" | "low" {
  const t = String(v ?? "").toLowerCase();
  if (t === "high" || t === "med" || t === "low") return t;
  return "low";
}

function normalizeQuery(q: string, maxChars: number): string {
  return q.replace(/\s+/g, " ").trim().slice(0, maxChars);
}

export function dedupeQueries(queries: string[], maxChars: number, maxCount: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of queries) {
    const nq = normalizeQuery(q, maxChars);
    if (!nq) continue;
    const key = nq.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(nq);
    if (out.length >= maxCount) break;
  }
  return out;
}

function normalizeUrlMaybe(url: string): string | null {
  const raw = url.trim();
  if (!raw) return null;
  const candidate = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    return new URL(candidate).toString();
  } catch {
    return null;
  }
}

export function sanitizeEvidenceTuple(
  tuple: Partial<EvidenceTuple>,
  fallbackUrl: string,
  quoteMaxChars: number
): EvidenceTuple | null {
  const claim = String(tuple.claim ?? "").replace(/\s+/g, " ").trim();
  const quote = String(tuple.evidence_quote ?? "").replace(/\s+/g, " ").trim().slice(0, quoteMaxChars);
  const sourceUrl = normalizeUrlMaybe(String(tuple.source_url ?? "")) ?? fallbackUrl;
  if (claim.length < 16) return null;
  if (quote.length < 24) return null;
  if (!sourceUrl) return null;
  return {
    claim,
    evidence_quote: quote,
    source_url: sourceUrl,
    confidence: coerceConfidence(tuple.confidence),
    is_time_sensitive: Boolean(tuple.is_time_sensitive),
  };
}

export function validateEvidenceTuples(
  tuples: EvidenceTuple[],
  maxTotal: number
): EvidenceTuple[] {
  const seen = new Set<string>();
  const out: EvidenceTuple[] = [];
  for (const t of tuples) {
    const key = `${t.claim.toLowerCase()}|${t.source_url.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= maxTotal) break;
  }
  return out;
}

function buildEvidenceTable(tuples: EvidenceTuple[]): SynthesisPayload["evidence_table"] {
  const byClaim = new Map<string, { urls: Set<string>; quotes: string[] }>();
  for (const t of tuples) {
    const cur = byClaim.get(t.claim) ?? { urls: new Set<string>(), quotes: [] };
    cur.urls.add(t.source_url);
    if (cur.quotes.length < 3) cur.quotes.push(t.evidence_quote);
    byClaim.set(t.claim, cur);
  }
  return [...byClaim.entries()].map(([claim, v]) => ({
    claim,
    source_urls: [...v.urls].slice(0, 4),
    quotes: v.quotes.slice(0, 3),
  }));
}

async function callJsonLlm(
  stage: string,
  systemPrompt: string,
  userPrompt: string,
  timeoutMs: number,
  maxTokens: number
): Promise<Record<string, unknown> | null> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  if (!apiKey) return null;
  const base = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model =
    process.env["AGENT_FAST_MODEL"]?.trim() ||
    process.env["EVAL_MODEL"]?.trim() ||
    "openai/gpt-4o-mini";
  try {
    const res = await withProviderRequestSpacing(
      { apiKey, baseURL: base },
      () =>
        fetchWithRetry(
          `${base}/chat/completions`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
              "HTTP-Referer": "https://github.com/liminal-ai",
              "X-Title": `Liminal-web-research-${stage}`,
            },
            body: JSON.stringify({
              model,
              temperature: 0.1,
              max_tokens: maxTokens,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
            }),
          },
          { timeoutMs }
        )
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) return null;
    try {
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

async function planQueries(question: string, cfg: ReturnType<typeof getWebResearchConfig>): Promise<string[]> {
  const planned = await callJsonLlm(
    "planner",
    "Generate concise web-research subqueries. Return JSON only: {\"queries\": string[]} with 2-4 diverse queries.",
    `Question:\n${question.slice(0, 800)}`,
    cfg.plannerTimeoutMs,
    250
  );
  const arr = Array.isArray(planned?.["queries"]) ? (planned?.["queries"] as unknown[]) : [];
  const fromModel = arr.filter((x): x is string => typeof x === "string");
  const fallback = [question];
  return dedupeQueries(fromModel.length > 0 ? fromModel : fallback, cfg.plannerQueryMaxChars, cfg.plannerQueriesMax);
}

function deterministicRerank(
  sources: ScoredSource[],
  k: number
): RerankDecision[] {
  const sorted = [...sources].sort((a, b) => a.tier - b.tier);
  return sorted.map((s, idx) => ({
    url: s.url,
    keep: idx < k,
    relevance: Math.max(0.1, 1 - idx * 0.08),
    novelty: 0.5,
    rationale: "tier-prioritized fallback",
  }));
}

async function rerankSources(
  question: string,
  sources: ScoredSource[],
  k: number,
  cfg: ReturnType<typeof getWebResearchConfig>
): Promise<RerankDecision[]> {
  if (sources.length === 0) return [];
  const payload = sources.map((s, i) => ({
    idx: i + 1,
    url: s.url,
    title: s.title.slice(0, 200),
    tier: s.tierLabel,
    excerpt: s.excerpt.slice(0, 700),
  }));
  const result = await callJsonLlm(
    "rerank",
    "Rank sources for answering a research question. Return JSON only: {\"items\": [{\"url\": string, \"keep\": boolean, \"relevance\": number, \"novelty\": number, \"rationale\": string}]}. Keep exactly the most useful sources.",
    `Question: ${question.slice(0, 500)}\nTarget keep count: ${k}\nSources:\n${JSON.stringify(payload).slice(0, 18_000)}`,
    cfg.rerankTimeoutMs,
    700
  );
  const items = Array.isArray(result?.["items"]) ? (result?.["items"] as unknown[]) : [];
  if (items.length === 0) return deterministicRerank(sources, k);
  const byUrl = new Map<string, RerankDecision>();
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const url = normalizeUrlMaybe(String(o["url"] ?? ""));
    if (!url) continue;
    byUrl.set(url, {
      url,
      keep: Boolean(o["keep"]),
      relevance: Number.isFinite(Number(o["relevance"])) ? Math.max(0, Math.min(1, Number(o["relevance"]))) : 0.5,
      novelty: Number.isFinite(Number(o["novelty"])) ? Math.max(0, Math.min(1, Number(o["novelty"]))) : 0.5,
      rationale: typeof o["rationale"] === "string" ? o["rationale"].slice(0, 140) : undefined,
    });
  }
  if (byUrl.size === 0) return deterministicRerank(sources, k);
  const scored = sources.map((s) => byUrl.get(s.url) ?? {
    url: s.url,
    keep: false,
    relevance: 0.2,
    novelty: 0.2,
    rationale: "not selected by model",
  });
  scored.sort((a, b) => (Number(b.keep) - Number(a.keep)) || (b.relevance + b.novelty) - (a.relevance + a.novelty));
  const top = new Set(scored.slice(0, k).map((x) => x.url));
  return scored.map((s) => ({ ...s, keep: top.has(s.url) }));
}

async function extractEvidenceForSource(
  question: string,
  source: ScoredSource,
  cfg: ReturnType<typeof getWebResearchConfig>
): Promise<EvidenceTuple[]> {
  const result = await callJsonLlm(
    "evidence",
    "Extract compact evidence tuples from one source. Return JSON only: {\"tuples\": [{\"claim\": string, \"evidence_quote\": string, \"source_url\": string, \"confidence\": \"high\"|\"med\"|\"low\", \"is_time_sensitive\": boolean}]}. Prefer precise, non-overlapping claims.",
    `Question: ${question.slice(0, 500)}\nSource URL: ${source.url}\nSource title: ${source.title}\nSource tier: ${source.tierLabel}\nExcerpt:\n${source.excerpt.slice(0, 2600)}`,
    cfg.evidenceTimeoutMs,
    700
  );
  const tuplesRaw = Array.isArray(result?.["tuples"]) ? (result?.["tuples"] as unknown[]) : [];
  const out: EvidenceTuple[] = [];
  for (const t of tuplesRaw) {
    if (!t || typeof t !== "object") continue;
    const cleaned = sanitizeEvidenceTuple(
      t as Partial<EvidenceTuple>,
      source.url,
      cfg.evidenceQuoteMaxChars
    );
    if (!cleaned) continue;
    out.push(cleaned);
    if (out.length >= cfg.evidencePerSourceMax) break;
  }
  return out;
}

async function synthesizeResearch(
  question: string,
  sources: ScoredSource[],
  evidenceTuples: EvidenceTuple[],
  cfg: ReturnType<typeof getWebResearchConfig>
): Promise<SynthesisPayload> {
  if (evidenceTuples.length === 0) {
    return {
      answer: "Unable to build high-confidence synthesis from available fetched evidence.",
      key_findings: [],
      contradictions: [],
      uncertain_claims: ["Insufficient validated evidence tuples."],
      evidence_table: [],
      confidence: "low",
    };
  }
  const input = {
    question: question.slice(0, 700),
    sources: sources.map((s) => ({ url: s.url, tier: s.tierLabel, title: s.title.slice(0, 120) })),
    evidence: evidenceTuples.slice(0, 24),
  };
  const parsed = await callJsonLlm(
    "synthesis",
    "Synthesize an answer from provided evidence tuples. Return JSON only with keys: answer, key_findings, contradictions, uncertain_claims, evidence_table, confidence. confidence must be high|med|low.",
    JSON.stringify(input).slice(0, 18_000),
    cfg.synthesisTimeoutMs,
    1200
  );
  const fallback: SynthesisPayload = {
    answer: "Synthesis fallback: presenting validated evidence without full narrative merge.",
    key_findings: evidenceTuples.slice(0, 5).map((e) => e.claim),
    contradictions: [],
    uncertain_claims: [],
    evidence_table: buildEvidenceTable(evidenceTuples),
    confidence: "med",
  };
  if (!parsed) return fallback;
  const answer = typeof parsed["answer"] === "string" ? parsed["answer"].trim() : fallback.answer;
  const keyFindings = Array.isArray(parsed["key_findings"])
    ? (parsed["key_findings"] as unknown[]).filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, 12)
    : fallback.key_findings;
  const contradictions = Array.isArray(parsed["contradictions"])
    ? (parsed["contradictions"] as unknown[]).filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, 10)
    : [];
  const uncertainClaims = Array.isArray(parsed["uncertain_claims"])
    ? (parsed["uncertain_claims"] as unknown[]).filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean).slice(0, 10)
    : [];
  const evidenceTableRaw = Array.isArray(parsed["evidence_table"]) ? (parsed["evidence_table"] as unknown[]) : [];
  const evidenceTable = evidenceTableRaw
    .map((it) => {
      if (!it || typeof it !== "object") return null;
      const o = it as Record<string, unknown>;
      const claim = typeof o["claim"] === "string" ? o["claim"].trim() : "";
      const sourceUrls = Array.isArray(o["source_urls"])
        ? (o["source_urls"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 4)
        : [];
      const quotes = Array.isArray(o["quotes"])
        ? (o["quotes"] as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 3)
        : [];
      if (!claim) return null;
      return { claim, source_urls: sourceUrls, quotes };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
  return {
    answer: answer || fallback.answer,
    key_findings: keyFindings.length > 0 ? keyFindings : fallback.key_findings,
    contradictions,
    uncertain_claims: uncertainClaims,
    evidence_table: evidenceTable.length > 0 ? evidenceTable : fallback.evidence_table,
    confidence: coerceConfidence(parsed["confidence"]),
  };
}

function renderWebResearchOutput(
  question: string,
  selected: ScoredSource[],
  rerank: RerankDecision[],
  tuples: EvidenceTuple[],
  synth: SynthesisPayload
): string {
  const sourceByUrl = new Map(selected.map((s) => [s.url, s]));
  const sourceLines = rerank
    .filter((d) => d.keep)
    .map((d, i) => {
      const s = sourceByUrl.get(d.url);
      if (!s) return null;
      return `${i + 1}. [${s.tierLabel}] **${s.title}**\n   ${s.url}\n   relevance=${d.relevance.toFixed(2)} novelty=${d.novelty.toFixed(2)}\n   _${s.excerpt.slice(0, 260)}…_`;
    })
    .filter((x): x is string => Boolean(x));
  const evidenceLines = tuples.slice(0, 12).map(
    (t, i) => `${i + 1}. ${t.claim}\n   - quote: "${t.evidence_quote}"\n   - source: ${t.source_url}\n   - confidence: ${t.confidence}${t.is_time_sensitive ? " · time-sensitive" : ""}`
  );
  const sections: string[] = [
    `## web_research — ${question.slice(0, 80)}`,
    `**Confidence:** ${synth.confidence}`,
    "",
    "### Answer",
    synth.answer,
    "",
    "### Key findings",
    ...(synth.key_findings.length > 0 ? synth.key_findings.map((x) => `- ${x}`) : ["- (none)"]),
    "",
    "### Sources selected",
    ...(sourceLines.length > 0 ? sourceLines : ["(none)"]),
    "",
    "### Evidence tuples",
    ...(evidenceLines.length > 0 ? evidenceLines : ["(none)"]),
  ];
  if (synth.contradictions.length > 0) {
    sections.push("", "### Contradictions", ...synth.contradictions.map((x) => `- ${x}`));
  }
  if (synth.uncertain_claims.length > 0) {
    sections.push("", "### Uncertain claims", ...synth.uncertain_claims.map((x) => `- ${x}`));
  }
  if (synth.evidence_table.length > 0) {
    sections.push("", "### Evidence table");
    for (const row of synth.evidence_table.slice(0, 10)) {
      sections.push(`- ${row.claim}`);
      if (row.source_urls.length > 0) sections.push(`  sources: ${row.source_urls.join(" | ")}`);
      if (row.quotes.length > 0) sections.push(`  quotes: ${row.quotes.join(" || ")}`);
    }
  }
  return sections.join("\n");
}

export const webResearchTool = defineTool({
  name: "web_research",
  description:
    "WHAT: Hybrid research pipeline (model-planned subqueries + deterministic search/fetch + model rerank + model evidence extraction + evidence-grounded synthesis).\n" +
    "WHEN: Multi-source factual comparison where contradictions and evidence quality matter.\n" +
    "Output includes: selected sources, evidence tuples, contradictions/uncertain claims, and structured synthesis confidence.\n" +
    "ARGS: question — topic; k_sources — pages to fetch (default 4, max 6).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      question: { type: "string" },
      k_sources: { type: "number", description: "How many top hits to fetch (default 4, max 6)" },
    },
    required: ["question"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    if (process.env["AGENT_WEB_RESEARCH"] !== "1") {
      return {
        ok: false,
        error: "Set AGENT_WEB_RESEARCH=1 to enable web_research orchestration.",
      };
    }
    const question = String(args["question"] ?? "").trim();
    const k = Math.min(6, Math.max(1, (args["k_sources"] as number | undefined) ?? 4));
    const cfg = getWebResearchConfig();
    if (!question) return { ok: false, error: "question required" };
    emit?.(`\nweb_research: planning queries — ${question.slice(0, 80)}\n`);
    const queries = await planQueries(question, cfg);
    emit?.(`  planner produced ${queries.length} query/queries\n`);

    const candidateByUrl = new Map<string, ScoredSource>();
    for (const q of queries) {
      emit?.(`  searching: ${q.slice(0, 90)}\n`);
      const sr = await runHtmlDdgSearch(q, Math.max(cfg.fetchPerQueryCap, k + 2));
      if (!sr.ok) continue;
      for (const h of sr.hits.slice(0, cfg.fetchPerQueryCap)) {
        const normalized = normalizeUrlMaybe(h.url.startsWith("//") ? `https:${h.url}` : h.url);
        if (!normalized || candidateByUrl.has(normalized)) continue;
        const hostname = (() => { try { return new URL(normalized).hostname; } catch { return normalized.slice(0, 40); } })();
        emit?.(`    → fetching ${hostname}\n`);
        const fr = await runWebFetch(normalized, cfg.excerptMaxChars, { includeAssets: false });
        if (!fr.ok) continue;
        const tier = scoreSourceDomain(normalized);
        candidateByUrl.set(normalized, {
          url: normalized,
          title: h.title,
          excerpt: fr.output.slice(0, cfg.excerptMaxChars),
          tier,
          tierLabel: SOURCE_TIER_LABELS[tier],
        });
        if (candidateByUrl.size >= cfg.rerankPoolMax) break;
      }
      if (candidateByUrl.size >= cfg.rerankPoolMax) break;
    }
    const candidates = [...candidateByUrl.values()];
    if (candidates.length === 0) {
      return { ok: false, error: "No sources fetched successfully for this question." };
    }

    emit?.(`  reranking ${candidates.length} candidates…\n`);
    const rerank = await rerankSources(question, candidates, k, cfg);
    const keepSet = new Set(rerank.filter((r) => r.keep).map((r) => r.url));
    const selected = candidates.filter((s) => keepSet.has(s.url)).slice(0, k);
    if (selected.length === 0) {
      selected.push(...candidates.sort((a, b) => a.tier - b.tier).slice(0, k));
    }

    emit?.(`  extracting evidence from ${Math.min(selected.length, cfg.evidenceSourcesMax)} sources…\n`);
    const tuplesRaw: EvidenceTuple[] = [];
    for (const s of selected.slice(0, cfg.evidenceSourcesMax)) {
      const tuples = await extractEvidenceForSource(question, s, cfg);
      tuplesRaw.push(...tuples);
    }
    const evidenceMaxTotal = cfg.evidencePerSourceMax * cfg.evidenceSourcesMax;
    const tuples = validateEvidenceTuples(tuplesRaw, evidenceMaxTotal);

    emit?.(`  synthesizing from ${tuples.length} evidence tuple(s)…\n`);
    const synth = await synthesizeResearch(question, selected, tuples, cfg);
    const out = renderWebResearchOutput(question, selected, rerank, tuples, synth);
    return { ok: true, output: out.slice(0, cfg.finalOutputMaxChars) };
  },
});
