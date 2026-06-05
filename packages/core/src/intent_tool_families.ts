/**
 * Intent → tool-family pre-seed for lazy loading (avoids activate_tool_family round-trips).
 */
import type { TurnIntentClass } from "./intent_inference.js";
import { mapContractToToolFamilies } from "./contract_tool_mapper.js";

const INTENT_BASE_FAMILIES: Partial<Record<TurnIntentClass, string[]>> = {
  coding: ["shell", "git", "code_intel"],
  execution: ["shell", "git", "code_intel"],
  // Knowledge & research turns are where the interlinked vault brain pays off —
  // pre-seed it so the model can read/search/write+link notes without an
  // activate_tool_family round-trip (the #1 reason the vault sat unused).
  knowledge: ["vault", "memory_advanced"],
  research: ["web", "vault", "memory_advanced"],
  introspection: ["vault", "memory_advanced"],
  creative: ["document"],
};

const MAX_BM25_FAMILIES = 2;

/**
 * Families to activate at send() after intent inference (deduped, registry-filtered).
 */
export function inferIntentToolFamilies(
  intent: TurnIntentClass,
  userMessage: string,
  opts?: { registryHas?: (name: string) => boolean }
): string[] {
  const has = opts?.registryHas ?? (() => true);
  const out = new Set<string>();

  for (const f of INTENT_BASE_FAMILIES[intent] ?? []) {
    if (has(f)) out.add(f);
  }

  const trimmed = userMessage.trim();
  if (trimmed.length >= 8) {
    const mapped = mapContractToToolFamilies(trimmed, intent ?? "coding", {
      maxFamilies: MAX_BM25_FAMILIES,
      threshold: 0.2,
    });
    for (const f of mapped.families) {
      if (has(f)) out.add(f);
    }
    if (/google|gmail|sheet|spreadsheet|gdoc|drive|calendar|workspace/i.test(trimmed)) {
      if (has("connectors")) out.add("connectors");
    }
  }

  return [...out];
}
