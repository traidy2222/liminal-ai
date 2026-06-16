import type OpenAI from "openai";
import { resolveHarnessEnvRaw } from "../harness_effective_env.js";
import type { RuntimePreferences } from "../runtime_prefs.js";
import { completeChatJson, getFastModelSlug } from "../router.js";
import type { InboxMessageMeta, InboxTriageCategory, InboxTriageVerdict } from "./types.js";
import { buildTriageUserContent, tryHeuristicInboxTriage } from "./heuristics.js";
import type { InboxRules } from "./types.js";
import { labelNameForCategory, type InboxWatcherConfig } from "./config.js";

const KNOWN_CATEGORIES = new Set<InboxTriageCategory>([
  "urgent",
  "action",
  "fyi",
  "newsletter",
  "automated",
  "spam",
]);

const TRIAGE_SYSTEM_PROMPT =
  "Classify one inbox message. Return JSON only with keys: " +
  "{category:string,confidence:number,summary:string,suggestedLabel:string,reason:string}. " +
  "category must be one of: urgent, action, fyi, newsletter, automated, spam. " +
  "urgent=time-sensitive human request; action=needs a response but not emergency; " +
  "fyi=informational; newsletter=marketing/digest; automated=system/notification; spam=unwanted. " +
  "confidence: 0-1. summary: <=120 chars. suggestedLabel: Liminal/* namespace. reason: <=120 chars.";

function isTriageEnabled(prefs: RuntimePreferences | null): boolean {
  return resolveHarnessEnvRaw("AGENT_INBOX_TRIAGE", prefs) !== "0";
}

function deriveNeedsReply(category: InboxTriageCategory): boolean {
  return category === "urgent" || category === "action";
}

export function parseInboxTriagePayload(raw: unknown): Omit<InboxTriageVerdict, "needsReply" | "source"> | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const catRaw = typeof o["category"] === "string" ? o["category"].trim().toLowerCase() : "";
  if (!KNOWN_CATEGORIES.has(catRaw as InboxTriageCategory)) return null;
  const category = catRaw as InboxTriageCategory;
  let confidence = typeof o["confidence"] === "number" ? o["confidence"] : parseFloat(String(o["confidence"] ?? ""));
  if (!Number.isFinite(confidence)) confidence = 0.5;
  confidence = Math.max(0, Math.min(1, confidence));
  const summary = typeof o["summary"] === "string" ? o["summary"].trim().slice(0, 120) : "";
  const reason = typeof o["reason"] === "string" ? o["reason"].trim().slice(0, 120) : summary;
  const suggestedLabel =
    typeof o["suggestedLabel"] === "string" && o["suggestedLabel"].trim()
      ? o["suggestedLabel"].trim().slice(0, 80)
      : labelNameForCategory(category) ?? "Liminal/Review";
  return { category, confidence, summary: summary || reason, suggestedLabel, reason: reason || summary };
}

export function triageInboxWithRules(message: InboxMessageMeta): InboxTriageVerdict {
  return {
    category: "fyi",
    needsReply: false,
    confidence: 0.55,
    summary: message.subject.slice(0, 120),
    suggestedLabel: "Liminal/Review",
    reason: "LLM unavailable — default fyi",
    source: "fallback",
  };
}

export async function triageInboxMessage(
  client: OpenAI,
  mainModel: string,
  message: InboxMessageMeta,
  rules: InboxRules,
  config: InboxWatcherConfig
): Promise<InboxTriageVerdict> {
  const heuristic = tryHeuristicInboxTriage(message, rules);
  if (heuristic) return heuristic;

  if (!isTriageEnabled(null)) {
    return triageInboxWithRules(message);
  }

  const cfg = config;
  const jr = await completeChatJson(client, {
    model: getFastModelSlug(mainModel),
    messages: [
      { role: "system", content: TRIAGE_SYSTEM_PROMPT },
      { role: "user", content: buildTriageUserContent(message) },
    ],
    maxTokens: 200,
    temperature: 0,
    signal: AbortSignal.timeout(cfg.triageTimeoutMs),
    isFastModel: true,
    fallbackModel: mainModel,
  });

  if (!jr.ok) {
    return triageInboxWithRules(message);
  }

  const parsed = parseInboxTriagePayload(jr.parsed);
  if (!parsed) {
    return triageInboxWithRules(message);
  }

  return {
    ...parsed,
    needsReply: deriveNeedsReply(parsed.category),
    source: "llm",
  };
}
