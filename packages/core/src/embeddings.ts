/**
 * OpenAI-compatible embedding fetch (OpenRouter, OpenAI, etc.).
 */
import { withProviderRequestSpacing } from "./provider_request_gate.js";
import { buildOpenRouterAttributionHeaders } from "./openrouter_attribution.js";
import { buildManagedInferenceClientHeaders } from "./inference_provider.js";
import { isManagedInferenceBaseUrl } from "./inference_session.js";
import type { RuntimePreferences } from "./runtime_prefs.js";

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

export interface EmbedBatchResult {
  vectors: number[][];
  model: string;
}

/** POST /v1/embeddings — returns one vector per input string (same order).
 * OpenRouter embeddings do not accept the chat `provider` object; routing is model-level only.
 */
export async function fetchEmbeddings(params: {
  apiKey: string;
  baseURL: string;
  model: string;
  inputs: string[];
  signal?: AbortSignal;
  prefs?: RuntimePreferences | null;
  extraHeaders?: Record<string, string>;
}): Promise<EmbedBatchResult> {
  const url = `${params.baseURL.replace(/\/$/, "")}/embeddings`;
  const managedHeaders = isManagedInferenceBaseUrl(params.baseURL)
    ? buildManagedInferenceClientHeaders(params.prefs ?? null, params.model)
    : {};
  return withProviderRequestSpacing(
    { apiKey: params.apiKey, baseURL: params.baseURL },
    async () => {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${params.apiKey}`,
          "Content-Type": "application/json",
          ...buildOpenRouterAttributionHeaders("embeddings"),
          ...managedHeaders,
          ...params.extraHeaders,
        },
        body: JSON.stringify({
          model: params.model,
          input: params.inputs.length === 1 ? params.inputs[0] : params.inputs,
        }),
        signal: params.signal,
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`embeddings HTTP ${res.status}: ${t.slice(0, 400)}`);
      }
      const json = (await res.json()) as {
        data?: Array<{ embedding: number[] }>;
        model?: string;
      };
      const rows = json.data ?? [];
      const vectors = rows.map((r) => r.embedding);
      if (vectors.length !== params.inputs.length) {
        throw new Error("embeddings response length mismatch");
      }
      return { vectors, model: json.model ?? params.model };
    }
  );
}
