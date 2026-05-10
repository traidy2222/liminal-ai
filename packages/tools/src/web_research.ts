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

async function synthesizeResearch(
  question: string,
  sources: ScoredSource[]
): Promise<string> {
  const apiKey = process.env["OPENROUTER_API_KEY"] ?? "";
  if (!apiKey || sources.length === 0) {
    return JSON.stringify({
      agreements: ["(synthesis skipped — no API key or no sources)"],
      disagreements: [],
      weak_claims: [],
      contradictions: [],
      confidence: "low",
    });
  }
  const base = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
  const model =
    process.env["AGENT_FAST_MODEL"]?.trim() ||
    process.env["EVAL_MODEL"]?.trim() ||
    "openai/gpt-4o-mini";

  const body = sources
    .map((s, i) =>
      `--- Source ${i + 1} [${s.tierLabel}]: ${s.url}\n${s.excerpt.slice(0, 2000)}`
    )
    .join("\n\n");

  try {
    const res = await fetchWithRetry(
      `${base}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://github.com/liminal-ai",
          "X-Title": "Liminal-web-research",
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          max_tokens: 1200,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You are a research analyst comparing web sources. Sources are tagged with credibility tiers: " +
                "T1-Authoritative (wire services, governments, top institutions), " +
                "T2-Quality (established outlets, think tanks, academic), " +
                "T3-Aggregator (Wikipedia, mixed-quality news), " +
                "T4-Unverified (blogs, social media, unknown). " +
                "Return JSON only with these fields:\n" +
                '{"agreements": string[], ' +
                '"disagreements": string[], ' +
                '"weak_claims": string[], ' +
                '"contradictions": string[], ' +
                '"confidence": "high"|"med"|"low", ' +
                '"tier_summary": string}\n\n' +
                "agreements: facts corroborated by ≥2 sources (note if any T1/T2).\n" +
                "disagreements: where sources conflict — name the conflict explicitly.\n" +
                "weak_claims: specific claims that appear only in T3/T4 sources with no T1/T2 corroboration.\n" +
                "contradictions: claims where T1/T2 sources directly contradict each other or contradict T3/T4.\n" +
                "confidence: overall evidence quality (high=mostly T1/T2 agreement, med=mixed tiers, low=T3/T4 dominated).\n" +
                "tier_summary: one sentence on source quality distribution.",
            },
            {
              role: "user",
              content: `Question: ${question.slice(0, 500)}\n\nSources:\n${body.slice(0, 12_000)}`,
            },
          ],
        }),
      },
      { timeoutMs: 25_000 }
    );
    if (!res.ok) {
      return JSON.stringify({
        agreements: [], disagreements: [`HTTP ${res.status}`],
        weak_claims: [], contradictions: [], confidence: "low", tier_summary: "synthesis failed",
      });
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? "{}";
  } catch (e) {
    return JSON.stringify({
      agreements: [], disagreements: [String(e)],
      weak_claims: [], contradictions: [], confidence: "low", tier_summary: "synthesis error",
    });
  }
}

export const webResearchTool = defineTool({
  name: "web_research",
  description:
    "WHAT: Run DuckDuckGo search, fetch top pages, score source credibility by tier, return excerpts + tier-aware synthesis.\n" +
    "WHEN: Multi-source factual comparison on current events, geopolitics, economics, or any claim-heavy research.\n" +
    "Output includes: per-source tier (T1-Authoritative → T4-Unverified), agreements corroborated by strong sources, " +
    "weak_claims (T3/T4 only — treat with skepticism), contradictions (sources disagree), confidence rating.\n" +
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
  handler: async (args) => {
    if (process.env["AGENT_WEB_RESEARCH"] !== "1") {
      return {
        ok: false,
        error: "Set AGENT_WEB_RESEARCH=1 to enable web_research orchestration.",
      };
    }
    const question = String(args["question"] ?? "").trim();
    const k = Math.min(6, Math.max(1, (args["k_sources"] as number | undefined) ?? 4));
    if (!question) return { ok: false, error: "question required" };

    const sr = await runHtmlDdgSearch(question, k + 2); // fetch extra hits to compensate for failed fetches
    if (!sr.ok) return sr;

    const sources: ScoredSource[] = [];
    for (const h of sr.hits.slice(0, k + 2)) {
      if (sources.length >= k) break;
      const u = h.url.startsWith("//") ? `https:${h.url}` : h.url;
      const fr = await runWebFetch(u, 4500);
      if (fr.ok) {
        const tier = scoreSourceDomain(u);
        sources.push({
          url: u,
          title: h.title,
          excerpt: fr.output.slice(0, 4000),
          tier,
          tierLabel: SOURCE_TIER_LABELS[tier],
        });
      }
    }

    // Sort: highest tier first so synthesis sees strongest sources early
    sources.sort((a, b) => a.tier - b.tier);

    const synth = await synthesizeResearch(question, sources);

    // Parse synthesis for structured display
    let synthObj: Record<string, unknown> = {};
    try { synthObj = JSON.parse(synth) as Record<string, unknown>; } catch { /* raw fallback */ }

    const tierBadge = (tier: SourceTier) =>
      tier === 1 ? "🟢T1" : tier === 2 ? "🔵T2" : tier === 3 ? "🟡T3" : "🔴T4";

    const sourceLines = sources.map(
      (s, i) =>
        `${i + 1}. ${tierBadge(s.tier)} **${s.title}**\n   ${s.url}\n   _${s.excerpt.slice(0, 350)}…_`
    );

    const weakClaims = (synthObj["weak_claims"] as string[] | undefined) ?? [];
    const contradictions = (synthObj["contradictions"] as string[] | undefined) ?? [];
    const agreements = (synthObj["agreements"] as string[] | undefined) ?? [];
    const disagreements = (synthObj["disagreements"] as string[] | undefined) ?? [];
    const confidence = (synthObj["confidence"] as string | undefined) ?? "unknown";
    const tierSummary = (synthObj["tier_summary"] as string | undefined) ?? "";

    const sections: string[] = [
      `## web_research — ${question.slice(0, 80)}`,
      `**Sources (${sources.length}) · confidence: ${confidence}**`,
      tierSummary ? `> ${tierSummary}` : "",
      "",
      "### Sources",
      ...sourceLines,
      "",
      "### Synthesis",
    ];
    if (agreements.length) {
      sections.push("**Corroborated facts:**");
      agreements.forEach((a) => sections.push(`- ${a}`));
    }
    if (weakClaims.length) {
      sections.push("\n⚠ **Weak claims (T3/T4 sources only — treat with skepticism):**");
      weakClaims.forEach((c) => sections.push(`- ${c}`));
    }
    if (contradictions.length) {
      sections.push("\n🔴 **Contradictions between sources:**");
      contradictions.forEach((c) => sections.push(`- ${c}`));
    }
    if (disagreements.length) {
      sections.push("\n**Disagreements:**");
      disagreements.forEach((d) => sections.push(`- ${d}`));
    }

    const out = sections.filter((s) => s !== "").join("\n");
    return { ok: true, output: out.slice(0, 28_000) };
  },
});
