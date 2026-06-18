/**
 * Gmail/Outlook compose — checks that outbound HTML looks intentionally styled.
 */
import { detectEmailPlaceholderViolations } from "@liminal/core";

const HTML_FIELD_KEYS = ["body_html", "html", "htmlBody", "html_body"] as const;
const PLAIN_FIELD_KEYS = ["body", "body_text", "text", "plain", "message", "plain_body"] as const;
const REPLY_FIELD_KEYS = [
  "reply_to_message_id",
  "thread_id",
  "threadId",
  "in_reply_to",
  "inReplyTo",
  "message_id",
] as const;

export function pickEmailHtmlField(args: Record<string, unknown>): string {
  for (const key of HTML_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function pickEmailPlainField(args: Record<string, unknown>): string {
  for (const key of PLAIN_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function isGmailThreadReply(args: Record<string, unknown>): boolean {
  for (const key of REPLY_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

/** One-liners and very short notes may stay plain. */
export function isSubstantivePlainBody(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length <= 120 && !/\n/.test(t)) return false;
  return true;
}

/** True when HTML shows deliberate styling (any tier — minimal through expressive). */
export function looksLikeFormattedEmailHtml(html: string): boolean {
  const h = html.trim();
  if (h.length < 20) return false;
  if (/<table\b/i.test(h)) return true;
  if (/\bbgcolor\s*=/i.test(h) && /<(?:td|tr|table)\b/i.test(h)) return true;
  if (
    /style\s*=\s*["'][^"']{3,}["']/i.test(h) &&
    /<(?:p|td|div|h[1-6]|span|a|li|blockquote|ul|ol)\b/i.test(h)
  ) {
    return true;
  }
  return false;
}

/**
 * Returns a remediation error when new outbound mail is plain-only or HTML is too bare.
 * Thread replies and one-liners pass through.
 */
/** Reject template placeholders and fake URLs in subject/body (R-PRODUCT-TRUTH). */
export function validateOutboundEmailFactual(args: Record<string, unknown>): string | null {
  const subject = typeof args["subject"] === "string" ? args["subject"] : "";
  const html = pickEmailHtmlField(args);
  const plain = pickEmailPlainField(args);
  const combined = [subject, plain, html].filter(Boolean).join("\n");
  return detectEmailPlaceholderViolations(combined);
}

export function validateOutboundEmailStyle(args: Record<string, unknown>): string | null {
  if (isGmailThreadReply(args)) return null;

  const factualErr = validateOutboundEmailFactual(args);
  if (factualErr) return factualErr;

  const html = pickEmailHtmlField(args);
  const plain = pickEmailPlainField(args);

  if (html) {
    if (looksLikeFormattedEmailHtml(html)) return null;
    return (
      "body_html must use intentional email-safe styling (nested tables and/or inline styles on text elements). " +
      "Compose the full formatted HTML before calling create_draft — the tool call is the deliverable."
    );
  }

  if (plain && isSubstantivePlainBody(plain)) {
    return (
      "New outbound mail is delivered as formatted body_html + plain body in one create_draft call. " +
      "Plan and write the HTML first, then call gmail_create_draft / outlook_create_draft with both fields. " +
      "Plain-only is for thread replies and one-liners."
    );
  }

  return null;
}
