import type { InboxMessageMeta, InboxRules, InboxTriageVerdict } from "./types.js";
import { labelNameForCategory } from "./config.js";

const NOREPLY_RE = /^(no-?reply|noreply|mailer-daemon|postmaster|donotreply)/i;
const NEWSLETTER_SUBJECT_RE = /(newsletter|unsubscribe|weekly digest|daily digest)/i;

function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : "";
}

function isVip(fromEmail: string, rules: InboxRules): boolean {
  const lower = fromEmail.toLowerCase();
  return rules.vipSenders.some((s) => lower === s.toLowerCase() || lower.endsWith(`@${s.toLowerCase().replace(/^@/, "")}`));
}

export function tryHeuristicInboxTriage(
  message: InboxMessageMeta,
  rules: InboxRules
): InboxTriageVerdict | null {
  const fromLocal = message.fromEmail.split("@")[0] ?? "";
  const domain = emailDomain(message.fromEmail);

  if (rules.denyDomains.some((d) => domain === d.toLowerCase())) {
    return verdict("spam", false, 0.92, "Denied domain rule", "heuristic");
  }

  if (isVip(message.fromEmail, rules)) {
    return verdict("urgent", true, 0.9, "VIP sender rule", "heuristic", "Liminal/VIP");
  }

  if (message.listUnsubscribe || rules.newsletterDomains.includes(domain)) {
    return verdict("newsletter", false, 0.9, "List-Unsubscribe or newsletter domain", "heuristic");
  }

  if (NOREPLY_RE.test(fromLocal) || NOREPLY_RE.test(message.fromEmail)) {
    return verdict("automated", false, 0.88, "No-reply sender address", "heuristic");
  }

  if (NEWSLETTER_SUBJECT_RE.test(message.subject)) {
    return verdict("newsletter", false, 0.85, "Newsletter subject pattern", "heuristic");
  }

  return null;
}

function verdict(
  category: InboxTriageVerdict["category"],
  needsReply: boolean,
  confidence: number,
  reason: string,
  source: InboxTriageVerdict["source"],
  labelOverride?: string
): InboxTriageVerdict {
  const derivedNeedsReply = category === "urgent" || category === "action";
  return {
    category,
    needsReply: needsReply || derivedNeedsReply,
    confidence,
    summary: reason.slice(0, 120),
    suggestedLabel: labelOverride ?? labelNameForCategory(category) ?? "Liminal/Review",
    reason,
    source,
  };
}

export function buildTriageUserContent(message: InboxMessageMeta): string {
  return (
    `FROM: ${message.from} <${message.fromEmail}>\n` +
    `SUBJECT: ${message.subject}\n` +
    `DATE: ${message.receivedAt}\n` +
    `SNIPPET: ${message.snippet.slice(0, 800)}`
  );
}
