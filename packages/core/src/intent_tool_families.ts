/**
 * Intent → tool-family pre-seed for lazy loading (avoids activate_tool_family round-trips).
 */
import type { TurnIntentClass } from "./intent_inference.js";
import { mapContractToToolFamilies } from "./contract_tool_mapper.js";

/** Shared AgentCard intent detector (duplicated here to avoid core → tools import). */
function messageMentionsAgentcard(text: string): boolean {
  return /agent\s*card|agentcard(?:\.ai)?|virtual card|x402|pay online|prepaid card|single-use card/i.test(
    text
  );
}

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
    if (/slack|channel message/i.test(trimmed) && has("slack")) out.add("slack");
    if (/linear|backlog/i.test(trimmed) && has("linear")) out.add("linear");
    if (/notion/i.test(trimmed) && has("notion")) out.add("notion");
    if (/xero|accounting invoice/i.test(trimmed) && has("xero")) out.add("xero");
    if (/github|pull request|merge request/i.test(trimmed) && has("github")) out.add("github");
    if (/outlook|onedrive|teams|planner|sharepoint|office 365|m365|microsoft/i.test(trimmed)) {
      if (has("microsoft_365")) out.add("microsoft_365");
    }
    if (/google|gmail|sheet|spreadsheet|gdoc|drive|calendar|workspace|docs|slides/i.test(trimmed)) {
      if (has("google_workspace")) out.add("google_workspace");
    }
    if (messageMentionsAgentcard(trimmed)) {
      if (has("agentcard")) out.add("agentcard");
    }
    if (
      /widget|dashboard|desktop app|spawn_app|pin.*visible|keep.*open|always.?visible|calculator window|live chart/i.test(
        trimmed
      )
    ) {
      if (has("liminal_apps")) out.add("liminal_apps");
    }
  }

  return [...out];
}
