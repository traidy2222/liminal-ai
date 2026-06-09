/**
 * Email compose turn detection + style-infer input guards.
 * Prevents recipes, memory, and vault context from steering outbound mail vertical/tone.
 */
import type { EmailStyleInferInput } from "./email_style_infer.js";

/** User turn that asks to compose, draft, or send email. */
export function isEmailComposeTurn(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  return (
    /\b(send|draft|compose|write)\b[\s\S]{0,96}\b(e-?mail|gmail|outlook|mail)\b/i.test(t) ||
    /\b(e-?mail|gmail|outlook)\b[\s\S]{0,96}\b(send|draft|compose|write)\b/i.test(t) ||
    /\bmail\s+to\b/i.test(t) ||
    /\bgmail_(send|create_draft)\b/i.test(t) ||
    /\boutlook_(send|create_draft)\b/i.test(t)
  );
}

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

export const EMAIL_COMPOSE_TURN_INJECTION =
  "[EMAIL COMPOSE] Write mail about **only what the user asked this turn**. " +
  "Do **not** infer industry, job title, vertical register, or visual style from recipes, " +
  "[KNOWN RECIPE]/[DEFAULT PLAN], recalled memory, persona, vault, or prior sessions unless the user named that vertical explicitly. " +
  "Signer name / company from memory is OK when needed for signature. " +
  "Default: neutral professional B2B HTML (R-EMAIL-STYLE) about the stated topic — skip email_style_infer unless the user asked for a specific industry look.";
