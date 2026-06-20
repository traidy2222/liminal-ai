/**
 * Fast-model entity extraction for the vault nexus.
 */
import OpenAI from "openai";
import {
  DEFAULT_AGENT_FAST_MODEL_SLUG,
  completeChatJson,
  ensureLocalProviderApiKeyInProcess,
  effectiveHarnessEnvRaw,
  resolveManagedOpenRouterCredentials,
} from "@liminal/core";
import type { ExtractedEntity, EntityKind } from "./vault_entity_merge.js";

const KINDS: EntityKind[] = ["person", "org", "place", "event", "concept"];

export type ExtractEntitiesResult = {
  entities: ExtractedEntity[];
  error?: string;
};

function coerceEntity(raw: unknown): ExtractedEntity | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const name = typeof o["name"] === "string" ? o["name"].trim() : "";
  if (!name || name.length > 120) return null;
  const kindRaw = typeof o["kind"] === "string" ? o["kind"].toLowerCase().trim() : "concept";
  const kind = (KINDS.includes(kindRaw as EntityKind) ? kindRaw : "concept") as EntityKind;
  const str = (k: string): string | undefined => {
    const v = o[k];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  const rels = Array.isArray(o["relationships"])
    ? (o["relationships"] as unknown[])
        .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
        .map((r) => r.trim())
        .slice(0, 12)
    : undefined;
  return {
    name,
    kind,
    summary: str("summary") ?? "",
    current: str("current"),
    history: str("history"),
    relationships: rels,
  };
}

function parseEntitiesFromJson(parsed: unknown, maxEntities: number): ExtractedEntity[] {
  const list =
    parsed && typeof parsed === "object" && Array.isArray((parsed as { entities?: unknown[] }).entities)
      ? (parsed as { entities: unknown[] }).entities
      : Array.isArray(parsed)
        ? parsed
        : [];
  const entities: ExtractedEntity[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const e = coerceEntity(raw);
    if (!e) continue;
    const key = e.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push(e);
    if (entities.length >= maxEntities) break;
  }
  return entities;
}

const EXTRACT_SYSTEM = (maxEntities: number) =>
  "You extract a knowledge graph from text. Output ONE JSON object per distinct subject — never bundle multiple " +
  "people/orgs into one row.\n" +
  "Kinds (pick the best fit):\n" +
  "- person, org, place — durable actors/locations (leaders, countries, companies, cities)\n" +
  "- event — wars, revolutions, treaties, votes, battles, incidents (temporal happenings)\n" +
  "- concept — doctrines, systems, movements, programs, abstract ideas (Axis of Resistance, nuclear program)\n" +
  "Each row becomes a standalone wiki dossier (Identity/Current/History/Relationships).\n" +
  "EVENT + CAST: the event is ONE row (kind:event). Every participant (people, orgs, venues) is a SEPARATE row " +
  "(person/org/place). Link via relationships[] using exact other names.\n" +
  `Reply JSON ONLY: {"entities":[{"name":"Exact Proper Name","kind":"person|org|place|event|concept",` +
  `"summary":"one line","current":"optional","history":"optional","relationships":["Other Name"]}]}\n` +
  `Rules: canonical proper names; one subject per row; max ${maxEntities} entities.`;

export async function extractEntities(
  content: string,
  opts?: { maxEntities?: number; timeoutMs?: number }
): Promise<ExtractEntitiesResult> {
  const text = content.trim();
  if (text.length < 40) {
    return { entities: [], error: "Content too short for entity extraction (min 40 chars)." };
  }
  const maxEntities = Math.max(1, Math.min(24, opts?.maxEntities ?? 12));

  ensureLocalProviderApiKeyInProcess();
  let apiKey =
    process.env["AGENT_API_KEY"]?.trim() ?? process.env["OPENROUTER_API_KEY"]?.trim() ?? "";
  let base = (process.env["AGENT_API_BASE_URL"] ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");

  try {
    const creds = await resolveManagedOpenRouterCredentials(null);
    if (creds.apiKey?.trim()) {
      apiKey = creds.apiKey;
      base = creds.baseURL;
    }
  } catch (err) {
    if (!apiKey) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        entities: [],
        error: `Provider unavailable for entity extraction: ${msg}. Set AGENT_API_KEY in .env.`,
      };
    }
  }

  if (!apiKey.trim()) {
    return { entities: [], error: "No API key for entity extraction — set AGENT_API_KEY." };
  }

  const model = effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim() || DEFAULT_AGENT_FAST_MODEL_SLUG;
  const client = new OpenAI({ apiKey, baseURL: base, maxRetries: 0 });
  const timeoutMs = opts?.timeoutMs ?? 60_000;

  try {
    const jr = await completeChatJson(client, {
      model,
      isFastModel: true,
      temperature: 0,
      maxTokens: 2500,
      signal: AbortSignal.timeout(timeoutMs),
      messages: [
        { role: "system", content: EXTRACT_SYSTEM(maxEntities) },
        { role: "user", content: text.slice(0, 12000) },
      ],
    });

    if (!jr.ok) {
      return {
        entities: [],
        error: `Entity extraction model call failed: ${jr.error ?? "unknown error"}`,
      };
    }

    const entities = parseEntitiesFromJson(jr.parsed, maxEntities);
    if (entities.length === 0) {
      const raw =
        typeof jr.parsed === "object" && jr.parsed !== null
          ? JSON.stringify(jr.parsed).slice(0, 200)
          : String(jr.parsed ?? "").slice(0, 200);
      return {
        entities: [],
        error: `Model returned no entities. Parsed: ${raw || "(empty)"}`,
      };
    }
    return { entities };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { entities: [], error: `Entity extraction failed: ${msg}` };
  }
}
