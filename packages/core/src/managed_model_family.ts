/**
 * Bedrock / managed-inference model family grouping for model pickers.
 *
 * Bedrock Mantle ids are usually `provider.model-id` (optional regional prefix:
 * `us.anthropic.claude-…`). Keyword fallbacks cover slugs without a dot prefix.
 */

const REGIONAL_PREFIX = /^(us|eu|global|au|jp|ap)-?\./i;

/** First segment of a Bedrock model id → canonical family key. */
const PROVIDER_PREFIX_TO_FAMILY: Record<string, string> = {
  anthropic: "anthropic",
  amazon: "amazon",
  meta: "meta",
  mistral: "mistral",
  ministral: "mistral",
  cohere: "cohere",
  openai: "openai",
  deepseek: "deepseek",
  qwen: "qwen",
  moonshotai: "moonshotai",
  google: "google",
  nvidia: "nvidia",
  ai21: "ai21",
  stability: "stability",
  writer: "writer",
  twelvelabs: "twelvelabs",
  luma: "luma",
};

const FAMILY_LABELS: Record<string, string> = {
  anthropic: "Anthropic",
  amazon: "Amazon",
  meta: "Meta",
  mistral: "Mistral",
  openai: "OpenAI",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  moonshotai: "Moonshot AI",
  google: "Google",
  nvidia: "NVIDIA",
  ai21: "AI21",
  stability: "Stability AI",
  writer: "Writer",
  twelvelabs: "Twelve Labs",
  luma: "Luma",
  other: "Other",
};

/** Sort order for grouped model dropdowns (lower = higher in list). */
const FAMILY_RANK: Record<string, number> = {
  anthropic: 0,
  openai: 1,
  amazon: 2,
  meta: 3,
  google: 4,
  deepseek: 5,
  qwen: 6,
  mistral: 7,
  moonshotai: 8,
  nvidia: 9,
  cohere: 10,
  ai21: 11,
  stability: 12,
  writer: 13,
  twelvelabs: 14,
  luma: 15,
  other: 99,
};

function bedrockProviderPrefix(id: string): string | null {
  let lower = id.trim().toLowerCase();
  if (!lower) return null;
  lower = lower.replace(REGIONAL_PREFIX, "");
  const dot = lower.indexOf(".");
  if (dot <= 0) return null;
  return lower.slice(0, dot);
}

function inferFamilyFromKeywords(id: string): string | null {
  const lower = id.toLowerCase();
  if (lower.includes("anthropic") || lower.includes("claude")) return "anthropic";
  if (lower.includes("nova") || lower.includes("titan")) return "amazon";
  if (lower.includes("llama")) return "meta";
  if (lower.includes("ministral") || lower.includes("mistral")) return "mistral";
  if (lower.includes("cohere") || lower.includes("command-r")) return "cohere";
  if (lower.includes("gpt-oss") || lower.includes("openai")) return "openai";
  if (lower.includes("deepseek")) return "deepseek";
  if (lower.includes("qwen")) return "qwen";
  if (lower.includes("moonshot") || lower.includes("kimi")) return "moonshotai";
  if (lower.includes("gemini") || lower.includes("gemma")) return "google";
  if (lower.includes("nemotron") || lower.includes("nvidia")) return "nvidia";
  if (lower.includes("jamba") || lower.includes("ai21")) return "ai21";
  if (lower.includes("stable-diffusion") || lower.includes("stability")) return "stability";
  if (lower.includes("palmyra") || lower.includes("writer")) return "writer";
  if (lower.includes("twelve") || lower.includes("pegasus")) return "twelvelabs";
  if (lower.includes("luma")) return "luma";
  return null;
}

/** Infer picker family from a Bedrock model id (or OpenRouter-style slug). */
export function inferManagedModelFamily(id: string): string {
  const prefix = bedrockProviderPrefix(id);
  if (prefix) {
    const mapped = PROVIDER_PREFIX_TO_FAMILY[prefix];
    if (mapped) return mapped;
  }
  return inferFamilyFromKeywords(id) ?? "other";
}

/** Prefer id-based inference when upstream sent `other` or left family empty. */
export function resolveManagedModelFamily(id: string, upstreamFamily?: string | null): string {
  const fromId = inferManagedModelFamily(id);
  if (fromId !== "other") return fromId;
  const upstream = upstreamFamily?.trim().toLowerCase();
  if (upstream && upstream !== "other") return upstream;
  return "other";
}

export function managedModelFamilyLabel(family: string): string {
  const key = family.trim().toLowerCase();
  const known = FAMILY_LABELS[key];
  if (known) return known;
  if (!key || key === "other") return "Other";
  return key
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function managedModelFamilyRank(family: string): number {
  return FAMILY_RANK[family.trim().toLowerCase()] ?? 50;
}
