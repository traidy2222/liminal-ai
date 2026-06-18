/**
 * Email compose turn detection + style-infer input guards.
 * Prevents recipes, memory, and vault context from steering outbound mail vertical/tone.
 */
import type { EmailStyleInferInput } from "./email_style_infer.js";

/** User turn that asks to compose, draft, or send email (including outreach with explicit addresses). */
export function isEmailComposeTurn(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  return (
    /\b(send|draft|compose|write)\b[\s\S]{0,96}\b(e-?mail|gmail|outlook|mail)\b/i.test(t) ||
    /\b(e-?mail|gmail|outlook)\b[\s\S]{0,96}\b(send|draft|compose|write)\b/i.test(t) ||
    /\bmail\s+to\b/i.test(t) ||
    /\b(reach\s+out|outreach|cold\s+(?:email|mail))\b/i.test(t) ||
    (/\b(send|draft|compose|write|email|e-?mail|outreach)\b/i.test(t) &&
      /@[\w.-]+\.\w{2,}/.test(t)) ||
    /\bgmail_(send|create_draft)\b/i.test(t) ||
    /\boutlook_(send|create_draft)\b/i.test(t)
  );
}

export function shouldInjectEmailComposeGuidance(text: string): boolean {
  return isEmailComposeTurn(text);
}

/**
 * Always-on mental model — appended to PROTOCOL_CORE so the model knows the default
 * before any tool call (not only after validation failures).
 */
export const EMAIL_COMPOSE_MENTAL_MODEL = `## Outbound email (default)
When the user wants mail sent or drafted, your **first** \`gmail_create_draft\` / \`outlook_create_draft\` call is the finished product: **subject + formatted \`body_html\` + plain \`body\` together**. Compose the full styled HTML in your reasoning first; the tool call delivers it — not plain text to upgrade later. Plain-only is only for thread replies (\`thread_id\` / \`reply_to_message_id\`) and one-liners. Never draft the letter in chat prose, never \`write_file\` workspace HTML, never \`mcp_google_gmail_create_draft\` for styled outbound mail.`;

/** Per-turn planning injection — what to produce before invoking compose tools. */
export const EMAIL_COMPOSE_TURN_INJECTION =
  "[EMAIL COMPOSE] Plan the **finished HTML email** before any tool call. " +
  "Your **first** gmail_create_draft / outlook_create_draft must already contain: `subject`, formatted `body_html` (nested `<table>` / inline styles, R-EMAIL-STYLE), and plain `body` fallback. " +
  "The tool call **is** the email — not a rough draft to fix later. " +
  "Use gmail_create_draft (REST), not mcp_google_gmail_create_draft (plain-only). " +
  "Do not write the letter in chat. Do not write_file workspace .html/.md. " +
  "Write about **only what the user asked this turn** — not recipes, memory verticals, persona, or vault unless they named that industry. " +
  "Signer name from memory is OK. Skip email_style_infer unless they asked for a specific visual style; default neutral professional B2B HTML. " +
  "Minimal shell to fill: `<table width=\"600\" role=\"presentation\"><tr><td style=\"padding:24px;font-family:Arial,Helvetica,sans-serif;color:#333;background:#fff\">…copy with inline styles…</td></tr></table>`";

/** Paired with google_workspace family preseed — reinforces tool choice. */
export const EMAIL_COMPOSE_CAPABILITY_NUDGE =
  "[EMAIL COMPOSE] gmail_create_draft carries the full styled email in body_html + body on the first call. " +
  "Gather signer/recipient if needed, then compose — do not plain-draft first.";

function messageContentLower(text: string): string {
  return text.trim().toLowerCase();
}

/** True when a style field's substance appears in the user's message (not invented). */
export function isEmailStyleFieldGroundedInUserMessage(value: string, userMessage: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const um = messageContentLower(userMessage);
  const vl = v.toLowerCase();
  if (um.includes(vl)) return true;
  const tokens = vl.split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  if (tokens.length === 0) return false;
  return tokens.some((tok) => um.includes(tok));
}

/**
 * Strip industry/tone/brand/background fields that were not stated in the user's message.
 * `background` is always dropped — common leak path for recipes and memory summaries.
 */
export function sanitizeEmailStyleInferInput(
  input: EmailStyleInferInput,
  userMessage: string
): EmailStyleInferInput {
  const grounded = (value?: string) =>
    value?.trim() && isEmailStyleFieldGroundedInUserMessage(value, userMessage) ? value.trim() : undefined;

  return {
    purpose: input.purpose,
    email_type: grounded(input.email_type),
    industry: grounded(input.industry),
    audience: grounded(input.audience),
    occasion: grounded(input.occasion),
    tone: grounded(input.tone),
    relationship: input.relationship?.trim() || undefined,
    visual_hint: grounded(input.visual_hint),
    brand_context: grounded(input.brand_context),
    background: undefined,
  };
}
