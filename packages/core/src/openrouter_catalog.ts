import { isMultiModelRouter } from "./model_policy.js";
/** Public OpenRouter catalog for settings. Never forwards local credentials. */
export interface OpenRouterCatalogModel {
  id: string;
  name: string;
  contextLength: number;
  inputModalities: string[];
  outputModalities: string[];
  supportsTools: boolean;
  promptPrice: string;
  completionPrice: string;
  isRouter: boolean;
}
export function parseOpenRouterSettingsCatalog(body: unknown): OpenRouterCatalogModel[] {
  const rows = (body as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(rows)) throw new Error("OpenRouter returned an invalid model catalog.");
  const unique = new Map<string, OpenRouterCatalogModel>();
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, any>;
    if (typeof r.id !== "string" || !r.id.trim()) continue;
    const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    unique.set(r.id, { id: r.id, name: typeof r.name === "string" ? r.name : r.id,
      contextLength: Number(r.context_length) || 0,
      inputModalities: strings(r.architecture?.input_modalities), outputModalities: strings(r.architecture?.output_modalities),
      supportsTools: strings(r.supported_parameters).includes("tools"),
      promptPrice: String(r.pricing?.prompt ?? ""), completionPrice: String(r.pricing?.completion ?? ""),
      isRouter: isMultiModelRouter(r.id),
    });
  }
  return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
}
let cached: { at: number; models: OpenRouterCatalogModel[] } | undefined;
let pending: Promise<OpenRouterCatalogModel[]> | undefined;
export async function fetchOpenRouterSettingsCatalog(refresh = false): Promise<OpenRouterCatalogModel[]> {
  if (!refresh && cached && Date.now() - cached.at < 15 * 60_000) return cached.models;
  if (pending) return pending;
  pending = (async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`OpenRouter model catalog unavailable (${response.status}). Try again.`);
    const models = parseOpenRouterSettingsCatalog(await response.json());
    if (!models.length) throw new Error("OpenRouter returned an empty model catalog. Try again.");
    cached = { at: Date.now(), models };
    return models;
  })();
  try { return await pending; } finally { pending = undefined; }
}
