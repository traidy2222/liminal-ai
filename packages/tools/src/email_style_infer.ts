/**
 * email_style_infer — enterprise-grade visual direction for any industry (no copy).
 */
import type { AgentHarness } from "@liminal/core";
import { emailStyleInferEnabled, inferEmailStyle } from "@liminal/core";
import OpenAI from "openai";
import { defineTool } from "./helpers.js";

export function createEmailStyleInferTool(harness: AgentHarness) {
  return defineTool({
    name: "email_style_infer",
    description:
      "WHAT: Infer enterprise-grade visual design for one outbound email — any industry, any style — **does not write copy or HTML**.\n" +
      "WHEN: Substantive styled mail before gmail_create_draft / gmail_send_message. Produces tier, industry_register, palette, layout, typography, premium_cues so body_html reads like a serious brand (not a template).\n" +
      "HOW: Pass purpose, industry, audience, brand_context, occasion, tone, visual_hint. Apply all fields when writing body_html in the **single** gmail/outlook call.\n" +
      "NOT FOR: thread replies, one-liners, plain-only mail.",
    parameters: {
      type: "object",
      properties: {
        purpose: { type: "string", description: "What this email must accomplish." },
        industry: {
          type: "string",
          description:
            "Vertical: fintech, healthcare, legal, luxury, SaaS, manufacturing, nonprofit, real estate, entertainment, etc.",
        },
        email_type: {
          type: "string",
          description: "investor_pitch | sales | follow_up | intro | thank_you | celebratory | general",
        },
        audience: { type: "string", description: "Role, firm, relationship (e.g. GP at growth fund, hospital CMO)." },
        brand_context: {
          type: "string",
          description: "Sender positioning: scale, brand voice, competitors, aesthetic refs.",
        },
        occasion: { type: "string" },
        tone: { type: "string" },
        relationship: { type: "string", description: "cold | warm | existing_thread" },
        visual_hint: {
          type: "string",
          description: "luxury, clinical, playful, minimalist, bold, institutional, etc.",
        },
        background: { type: "string", description: "Brief context (≤2.5k chars)." },
      },
      required: ["purpose"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: false,
    handler: async (args) => {
      if (!emailStyleInferEnabled()) {
        return {
          ok: false,
          error: "Email style infer is off. Set AGENT_EMAIL_STYLE_INFER=1 (default).",
        };
      }
      const { openRouterApiKey, model, baseURL } = harness.config;
      if (!openRouterApiKey) {
        return { ok: false, error: "AGENT_API_KEY not configured." };
      }

      const client = new OpenAI({ apiKey: openRouterApiKey, baseURL });
      const result = await inferEmailStyle(client, model, {
        purpose: String(args["purpose"] ?? ""),
        industry: typeof args["industry"] === "string" ? args["industry"] : undefined,
        email_type: typeof args["email_type"] === "string" ? args["email_type"] : undefined,
        audience: typeof args["audience"] === "string" ? args["audience"] : undefined,
        brand_context:
          typeof args["brand_context"] === "string" ? args["brand_context"] : undefined,
        occasion: typeof args["occasion"] === "string" ? args["occasion"] : undefined,
        tone: typeof args["tone"] === "string" ? args["tone"] : undefined,
        relationship:
          typeof args["relationship"] === "string" ? args["relationship"] : undefined,
        visual_hint: typeof args["visual_hint"] === "string" ? args["visual_hint"] : undefined,
        background: typeof args["background"] === "string" ? args["background"] : undefined,
      });

      if (!result.ok) return { ok: false, error: result.error };

      const s = result.data;
      return {
        ok: true,
        output:
          `Style direction — apply when writing body_html (enterprise bar, industry-native). ` +
          `Copy: R-EMAIL-COPY — no em/en dashes in subject or body; use commas or short sentences.\n` +
          `tier: ${s.tier}\n` +
          `industry_register: ${s.industry_register}\n` +
          `palette: ${s.palette}\n` +
          `layout: ${s.layout}\n` +
          `typography: ${s.typography}\n` +
          `premium_cues: ${s.premium_cues}\n` +
          `avoid: ${s.avoid}\n` +
          `novelty_note: ${s.novelty_note}`,
      };
    },
  });
}
