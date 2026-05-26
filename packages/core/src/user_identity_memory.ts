/**
 * User identity memory — LLM inference for recall/store; no keyword recall heuristics.
 */
import type OpenAI from "openai";
import { readFile } from "node:fs/promises";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { notesPaths, pickReadPath } from "./global_storage.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

/** Canonical exact keys tried before scanning the notes file. */
export const IDENTITY_MEMORY_KEYS = [
  "user:name",
  "user:preferred_name",
  "user:display_name",
  "identity:name",
  "identity:preferred_name",
  "entity:user_name",
  "entity:user_full_name",
  "entity:preferred_name",
  "fact:user_name",
  "fact:preferred_name",
  "pref:name",
  "pref:call_name",
] as const;

const IDENTITY_PREFIXES = ["user:", "identity:", "pref:"] as const;

type RawNote = string | { value?: string; scope?: string };

function noteValue(raw: RawNote): string {
  return typeof raw === "string" ? raw : String(raw?.value ?? "");
}

function isIdentityKey(key: string): boolean {
  const lower = key.toLowerCase();
  return IDENTITY_PREFIXES.some((p) => lower.startsWith(p));
}

/** Load user:/identity:/pref: notes from the global notes file (no BM25). */
export async function loadIdentityNotesFromDisk(): Promise<Array<{ key: string; value: string }>> {
  try {
    const notesFile = await pickReadPath(notesPaths(resolveWorkspaceRoot()));
    const raw = await readFile(notesFile, "utf8");
    const parsed = JSON.parse(raw) as Record<string, RawNote>;
    const out: Array<{ key: string; value: string }> = [];
    for (const [key, entry] of Object.entries(parsed)) {
      if (!isIdentityKey(key)) continue;
      const value = noteValue(entry).trim();
      if (value.length < 1) continue;
      out.push({ key, value: value.slice(0, 500) });
    }
    out.sort((a, b) => a.key.localeCompare(b.key));
    return out;
  } catch {
    return [];
  }
}

export function formatIdentityRecallBlock(notes: Array<{ key: string; value: string }>): string {
  if (notes.length === 0) return "(no identity notes on file)";
  return notes.map((n) => `- [${n.key}] ${n.value}`).join("\n");
}

export interface IdentityNameExtraction {
  preferredName: string;
  storageKey: string;
}

/**
 * Fast-model extraction when the user states how to address them.
 * Returns null when they did not provide a storable name.
 */
export async function extractPreferredNameFromMessage(
  userMessage: string,
  client: OpenAI,
  defaultModel: string
): Promise<IdentityNameExtraction | null> {
  const msg = userMessage.trim();
  if (msg.length < 2 || msg.length > 800) return null;

  const r = await completeChatJson(client, {
    model: getFastModelSlug(defaultModel),
    messages: [
      {
        role: "system",
        content:
          "Decide if the user is telling you their name or what to call them (not asking what their name is).\n" +
          'Return JSON: {"providesName":boolean,"preferredName":string|null,"storageKey":string|null}\n' +
          "storageKey should be user:name unless they specify another stable key.\n" +
          "preferredName: the name to use (1–4 words). providesName=false for questions like 'what is my name?'.",
      },
      { role: "user", content: msg.slice(0, 800) },
    ],
    maxTokens: 120,
    temperature: 0,
    signal: AbortSignal.timeout(8000),
  });

  if (!r.ok || typeof r.parsed !== "object" || r.parsed === null) return null;
  const obj = r.parsed as Record<string, unknown>;
  if (!obj["providesName"]) return null;
  const name = typeof obj["preferredName"] === "string" ? obj["preferredName"].trim() : "";
  if (!name || name.length > 80) return null;
  const keyRaw = typeof obj["storageKey"] === "string" ? obj["storageKey"].trim() : "user:name";
  const storageKey = keyRaw.includes(":") ? keyRaw.slice(0, 120) : "user:name";
  if (!isIdentityKey(storageKey) && !IDENTITY_MEMORY_KEYS.includes(storageKey as (typeof IDENTITY_MEMORY_KEYS)[number])) {
    return { preferredName: name, storageKey: "user:name" };
  }
  return { preferredName: name, storageKey };
}

/** When the harness should auto-call recall at the start of a ReAct round. */
export function shouldPrimeMemoryThisRound(opts: {
  recallEvery: number;
  round: number;
  round0PrimeEnabled: boolean;
  dreamScorePassedGate: boolean;
}): boolean {
  if (opts.round === 0) {
    return opts.round0PrimeEnabled && opts.dreamScorePassedGate;
  }
  const every = Math.max(0, opts.recallEvery);
  if (every <= 0) return false;
  return opts.round > 0 && opts.round % every === 0;
}
