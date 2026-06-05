/**
 * Shared embedding access for the vault nexus tools (ingest + recall).
 * Resolves provider creds the same way memory_autolink does, then runs a
 * semantic (cosine) query against the on-disk vault embedding index.
 * Degrades silently to an empty result when embeddings are unavailable so
 * callers can fall back to BM25.
 */
import {
  effectiveHarnessEnvRaw,
  fetchEmbeddings,
  resolveManagedOpenRouterCredentials,
} from "@liminal/core";
import { loadVaultEmbedIndex, embedQueryAgainstVaultIndex } from "./vault_index.js";

export interface EmbedCreds {
  apiKey: string;
  baseURL: string;
  model: string;
}

export async function resolveEmbedCreds(): Promise<EmbedCreds | null> {
  const model = effectiveHarnessEnvRaw("AGENT_EMBED_MODEL")?.trim();
  if (!model) return null; // BM25-only mode
  let apiKey =
    process.env["OPENROUTER_API_KEY"]?.trim() ?? process.env["AGENT_API_KEY"]?.trim() ?? "";
  let baseURL = (process.env["OPENROUTER_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(
    /\/$/,
    ""
  );
  try {
    const creds = await resolveManagedOpenRouterCredentials(null);
    apiKey = creds.apiKey;
    baseURL = creds.baseURL;
  } catch {
    if (!apiKey) return null;
  }
  return { apiKey, baseURL, model };
}

export interface SemanticHit {
  slug: string;
  title: string;
  type: string;
  score: number;
}

/** Semantic search over the vault embedding index. Empty array on any failure. */
export async function semanticVaultHits(
  text: string,
  limit: number,
  creds?: EmbedCreds | null
): Promise<SemanticHit[]> {
  const c = creds ?? (await resolveEmbedCreds());
  if (!c) return [];
  try {
    const { vectors } = await fetchEmbeddings({
      apiKey: c.apiKey,
      baseURL: c.baseURL,
      model: c.model,
      inputs: [text.slice(0, 8000)],
    });
    const qv = vectors[0];
    if (!qv || !qv.length) return [];
    const idx = await loadVaultEmbedIndex();
    return embedQueryAgainstVaultIndex(qv, idx, limit);
  } catch {
    return [];
  }
}
