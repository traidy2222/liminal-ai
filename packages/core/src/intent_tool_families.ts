/**
 * Intent → tool-family pre-seed for lazy loading (avoids activate_tool_family round-trips).
 */
import type { TurnIntentClass } from "./intent_inference.js";
import { isEmailComposeTurn } from "./email_compose_context.js";
import { mapContractToToolFamilies } from "./contract_tool_mapper.js";
import { browserChannelRequested } from "./requested_tool_channel.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { browserFirstSuppressedTools } from "./browser_first_policy.js";

/** Shared AgentCard intent detector (duplicated here to avoid core → tools import). */
function messageMentionsAgentcard(text: string): boolean {
  return /agent\s*card|agentcard(?:\.ai)?|virtual card|x402|pay online|prepaid card|single-use card/i.test(
    text,
  );
}

const INTENT_BASE_FAMILIES: Partial<Record<TurnIntentClass, string[]>> = {
  coding: ["shell", "git", "code_intel"],
  execution: ["shell", "git", "code_intel"],
  // Knowledge, introspection and creative prose do not imply external work.
  // Basic memory remains in the small always-set; advanced families are discoverable.
};

function isConnectedFamily(family: string): boolean {
  return (
    /^(?:google_|microsoft_|connector:)/.test(family) ||
    [
      "github",
      "slack",
      "linear",
      "notion",
      "aws",
      "azure",
      "xero",
      "youtube",
      "agentcard",
    ].includes(family)
  );
}

const MAX_BM25_FAMILIES = 2;

/**
 * Families to activate at send() after intent inference (deduped, registry-filtered).
 */
export function inferIntentToolFamilies(
  intent: TurnIntentClass,
  userMessage: string,
  opts?: { registryHas?: (name: string) => boolean },
): string[] {
  const has = opts?.registryHas ?? (() => true);
  if (intent === "conversational") return [];
  const out = new Set<string>();
  const browserOnly = browserChannelRequested(userMessage);
  const browserFirst = effectiveHarnessEnvRaw("AGENT_WEB_SEARCH_FETCH") !== "1";
  const suppressed = new Set(browserFirstSuppressedTools(userMessage));

  for (const f of (intent === "research" ? [browserFirst ? "browser" : "web"] : INTENT_BASE_FAMILIES[intent] ?? [])) {
    if (has(f)) out.add(f);
  }

  const trimmed = userMessage.trim();
  if (trimmed.length >= 8) {
    // Fuzzy matches on ordinary prose ("label", "word", "reply") were loading
    // entire document/vault catalogs. Use this broad matcher only for action turns.
    if (["coding", "execution", "research"].includes(intent)) {
      const mapped = mapContractToToolFamilies(trimmed, intent, {
        maxFamilies: MAX_BM25_FAMILIES,
        threshold: 0.2,
      });
      for (const f of mapped.families) {
        const family = browserFirst && (f === "web" || (f === "markets" && suppressed.has("markets_quote"))) ? "browser" : f;
        if (has(family)) out.add(family);
      }
    }
    if (
      /\bspawn_agent\b|\bwait_for_agents\b|\bdepends_on\b/i.test(trimmed) &&
      has("orchestration")
    ) {
      out.add("orchestration");
    }
    if (
      /\bsymbol_index\b|\bfind_references\b|\bcode-ops\b/i.test(trimmed) &&
      has("code_intel")
    ) {
      out.add("code_intel");
    }
    if (
      /\bvault_write\b|\bvault_search\b|\bwiki knowledge\b/i.test(trimmed) &&
      has("vault")
    ) {
      out.add("vault");
    }
    if (
      /\b(verify_result|evidence_critic|path_critic|policy_critic)\b/i.test(
        trimmed,
      ) &&
      has("orchestration")
    ) {
      out.add("orchestration");
    }
    if (/slack|channel message/i.test(trimmed) && has("slack"))
      out.add("slack");
    if (/linear|backlog/i.test(trimmed) && has("linear")) out.add("linear");
    if (/notion/i.test(trimmed) && has("notion")) out.add("notion");
    if (/xero|accounting invoice/i.test(trimmed) && has("xero"))
      out.add("xero");
    if (/github|pull request|merge request/i.test(trimmed) && has("github"))
      out.add("github");
    if (/outlook|mail\b|send email/i.test(trimmed)) {
      if (has("microsoft_mail")) out.add("microsoft_mail");
    }
    if (
      /calendar|meeting|schedule|freebusy/i.test(trimmed) &&
      /microsoft|outlook|m365|office 365/i.test(trimmed)
    ) {
      if (has("microsoft_calendar")) out.add("microsoft_calendar");
    }
    if (/onedrive|sharepoint|excel/i.test(trimmed)) {
      if (has("microsoft_files")) out.add("microsoft_files");
    }
    if (/teams|planner|todo|onenote/i.test(trimmed)) {
      if (has("microsoft_collab")) out.add("microsoft_collab");
    }
    if (
      /outlook|onedrive|teams|planner|sharepoint|office 365|m365|microsoft/i.test(
        trimmed,
      )
    ) {
      if (has("microsoft_365")) out.add("microsoft_365");
      else if (has("microsoft_mail")) out.add("microsoft_mail");
    }
    if (
      /azure|resource group|key vault|app service|cosmos|aks|blob storage|arm template/i.test(
        trimmed,
      )
    ) {
      if (has("azure")) out.add("azure");
    }
    if (
      /\baws\b|ec2|s3 bucket|lambda function|dynamodb|cloudformation|iam role|route ?53|api gateway|eks cluster|ecs task/i.test(
        trimmed,
      )
    ) {
      if (has("aws")) out.add("aws");
    }
    if (/gmail|inbox|send mail/i.test(trimmed)) {
      if (has("google_mail")) out.add("google_mail");
    }
    if (
      /calendar|meeting|schedule|freebusy/i.test(trimmed) &&
      /google|gmail|workspace/i.test(trimmed)
    ) {
      if (has("google_calendar")) out.add("google_calendar");
    }
    if (/sheet|spreadsheet|gdoc|docs|slides/i.test(trimmed)) {
      if (has("google_office")) out.add("google_office");
    }
    if (/\bdrive\b/i.test(trimmed) && /google/i.test(trimmed)) {
      if (has("google_drive")) out.add("google_drive");
    }
    if (/analytics|search console|ga4|seo\b/i.test(trimmed)) {
      if (has("google_marketing")) out.add("google_marketing");
    }
    if (
      /google|gmail|sheet|spreadsheet|gdoc|drive|calendar|workspace|docs|slides/i.test(
        trimmed,
      )
    ) {
      if (has("google_workspace")) out.add("google_workspace");
      else if (has("google_mail")) out.add("google_mail");
    }
    if (
      /youtube|yt studio|channel analytics|video seo|shorts feed|subscriber count|views declined/i.test(
        trimmed,
      ) &&
      has("youtube")
    ) {
      out.add("youtube");
    }
    if (isEmailComposeTurn(trimmed)) {
      if (has("google_mail")) out.add("google_mail");
      else if (has("google_workspace")) out.add("google_workspace");
      if (has("microsoft_mail")) out.add("microsoft_mail");
      else if (has("microsoft_365")) out.add("microsoft_365");
    }
    if (messageMentionsAgentcard(trimmed)) {
      if (has("agentcard")) out.add("agentcard");
    }
    if (
      /ida|reverse engineering|disassembl|decompil|crackme|malware analysis|patch.*dll|crack|steam_api|binary analysis|pe file|xrefs? to/i.test(
        trimmed,
      )
    ) {
      if (has("ida")) out.add("ida");
      if (has("shell")) out.add("shell");
      if (has("files_edit")) out.add("files_edit");
    }
    if (
      /widget|dashboard|desktop app|spawn_app|pin.*visible|keep.*open|always.?visible|calculator window|live chart/i.test(
        trimmed,
      )
    ) {
      if (has("liminal_apps")) out.add("liminal_apps");
    }
  }

  if (browserOnly && has("browser")) out.add("browser");
  return [...out].filter((family) => {
    // Broad provider parents expand into every subfamily. Never preload them
    // from incidental words such as a local "workspace" or a /docs/ URL.
    if (family === "google_workspace" || family === "microsoft_365")
      return false;
    if (browserOnly && (isConnectedFamily(family) || family === "web"))
      return false;
    if (
      browserOnly &&
      intent !== "coding" &&
      ["shell", "git", "code_intel"].includes(family)
    )
      return false;
    return true;
  });
}
