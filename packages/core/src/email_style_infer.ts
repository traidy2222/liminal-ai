/**
 * Style-only email sidecar — infers visual direction (no copy, no HTML body).
 * Main agent writes subject/body/body_html once into gmail/outlook tools.
 */
import type OpenAI from "openai";
import { completeChatJson, getFastModelSlug } from "./router.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export type EmailStyleTier = "minimal" | "polished" | "expressive";

export interface EmailStyleInferInput {
  purpose: string;
  email_type?: string;
  /** Industry or vertical: fintech, healthcare, legal, luxury, SaaS, manufacturing, etc. */
  industry?: string;
  audience?: string;
  occasion?: string;
  tone?: string;
  relationship?: string;
  visual_hint?: string;
  /** Sender brand context: scale, positioning, known competitors or aesthetic refs. */
  brand_context?: string;
  background?: string;
}

export interface EmailStyleInferResult {
  tier: EmailStyleTier;
  /** How this industry signals credibility visually (not generic "corporate"). */
  industry_register: string;
  palette: string;
  layout: string;
  typography: string;
  /** Whitespace, restraint, dividers, details that read enterprise-grade. */
  premium_cues: string;
  avoid: string;
  novelty_note: string;
}

export function emailStyleInferEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_EMAIL_STYLE_INFER") !== "0";
}

const STYLE_SYSTEM = `You are a world-class email art director for Fortune-scale brands across every industry.
You infer VISUAL DESIGN DIRECTION for one email — never write subject, body, copy, or HTML.

Output JSON only:
{"tier":"minimal"|"polished"|"expressive","industry_register":string,"palette":string,"layout":string,"typography":string,"premium_cues":string,"avoid":string,"novelty_note":string}

Quality bar: the result should plausibly come from a $100M+ company — confident restraint, intentional hierarchy, industry-native aesthetics. Not startup clipart, not Mailchimp generic, not AI template sludge.

tier:
- minimal — operational, intimate, senior-exec brief; still premium (spacing, type), never cheap.
- polished — default for B2B, investor, legal, healthcare, enterprise SaaS, professional services.
- expressive — consumer, lifestyle, celebration, entertainment, hospitality; still refined, not garish.

industry_register: 1–2 sentences — visual language native to THIS vertical (e.g. medtech = clinical clarity + trust blues; luxury = serif, wide margins; fintech = crisp grids + one accent; creative agency = bold asymmetry). Adapt to any industry in the brief.

palette: specific colors (hex encouraged) fit industry + audience + occasion. Enterprise = restrained (often 1 accent + neutrals). Never default to the same navy header every email.

layout: unique structure for THIS message — bands, grids, asymmetry, letterhead cues, data blocks — email-safe tables. No named reusable template.

typography: explicit scale (px), serif vs sans pairing, heading/body/caption treatment — vary by industry.

premium_cues: whitespace, line-height, divider weight, CTA treatment, footer restraint — details that signal serious brand ops.

avoid: concrete anti-patterns for this brief (cheap gradients, emoji walls, centered blue header band, hype adjectives in design notes).

novelty_note: ≤120 chars — one distinctive visual idea so this email cannot be mistaken for a template.

Do NOT output email copy. Style direction only.

Never invent an industry or vertical from background context — only INDUSTRY/TONE/VISUAL_HINT lines explicitly grounded in PURPOSE. When industry is omitted, use neutral professional B2B tech register.`;

function normalizeTier(raw: unknown): EmailStyleTier {
  const t = String(raw ?? "polished").trim().toLowerCase();
  if (t === "minimal" || t === "expressive") return t;
  return "polished";
}

function buildUserPrompt(input: EmailStyleInferInput): string {
  const lines: string[] = [`PURPOSE: ${input.purpose.trim()}`];
  if (input.email_type?.trim()) lines.push(`EMAIL_TYPE: ${input.email_type.trim()}`);
  if (input.industry?.trim()) lines.push(`INDUSTRY: ${input.industry.trim()}`);
  if (input.audience?.trim()) lines.push(`AUDIENCE: ${input.audience.trim()}`);
  if (input.occasion?.trim()) lines.push(`OCCASION: ${input.occasion.trim()}`);
  if (input.tone?.trim()) lines.push(`TONE: ${input.tone.trim()}`);
  if (input.relationship?.trim()) lines.push(`RELATIONSHIP: ${input.relationship.trim()}`);
  if (input.visual_hint?.trim()) lines.push(`VISUAL_HINT: ${input.visual_hint.trim()}`);
  if (input.brand_context?.trim()) lines.push(`BRAND_CONTEXT: ${input.brand_context.trim()}`);
  if (input.background?.trim()) {
    lines.push(`BACKGROUND:\n${input.background.trim().slice(0, 2500)}`);
  }
  lines.push(
    "",
    "Infer enterprise-grade visual direction native to this industry — unique, not a stock template."
  );
  return lines.join("\n");
}

export async function inferEmailStyle(
  client: OpenAI,
  mainModel: string,
  input: EmailStyleInferInput
): Promise<{ ok: true; data: EmailStyleInferResult } | { ok: false; error: string }> {
  if (!emailStyleInferEnabled()) {
    return { ok: false, error: "Email style infer is off (set AGENT_EMAIL_STYLE_INFER=1)." };
  }
  if (!input.purpose?.trim()) {
    return { ok: false, error: "purpose is required" };
  }

  const jr = await completeChatJson(client, {
    model: getFastModelSlug(mainModel),
    isFastModel: true,
    fallbackModel: mainModel,
    maxTokens: 900,
    temperature: 0.72,
    cache: false,
    signal: AbortSignal.timeout(35_000),
    messages: [
      { role: "system", content: STYLE_SYSTEM },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  if (!jr.ok) {
    return { ok: false, error: jr.error };
  }
  if (typeof jr.parsed !== "object" || jr.parsed === null) {
    return { ok: false, error: "style infer returned invalid JSON" };
  }

  const obj = jr.parsed as Record<string, unknown>;
  const industry_register = String(obj["industry_register"] ?? "").trim();
  const palette = String(obj["palette"] ?? "").trim();
  const layout = String(obj["layout"] ?? "").trim();
  const typography = String(obj["typography"] ?? "").trim();
  const premium_cues = String(obj["premium_cues"] ?? "").trim();
  const avoid = String(obj["avoid"] ?? "").trim();
  const novelty_note = String(obj["novelty_note"] ?? "").trim();

  if (!palette || !layout) {
    return { ok: false, error: "style infer omitted palette or layout" };
  }

  return {
    ok: true,
    data: {
      tier: normalizeTier(obj["tier"]),
      industry_register:
        industry_register || "Professional register: clear hierarchy, restrained palette, generous whitespace.",
      palette,
      layout,
      typography: typography || "Web-safe pairing with explicit px scale and line-height.",
      premium_cues:
        premium_cues ||
        "24–32px section padding, subtle 1px dividers, single confident CTA, muted legal footer.",
      avoid: avoid || "Generic centered template, stock startup gradients, emoji clutter.",
      novelty_note: novelty_note || "Industry-specific layout choice — not a reusable card.",
    },
  };
}
