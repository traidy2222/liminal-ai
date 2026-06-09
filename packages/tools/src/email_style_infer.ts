/**
 * email_style_infer — enterprise-grade visual direction for any industry (no copy).
 */
import type { AgentHarness } from "@liminal/core";
import { emailStyleInferEnabled, inferEmailStyle, sanitizeEmailStyleInferInput } from "@liminal/core";
import OpenAI from "openai";
import { defineTool } from "./helpers.js";

export function createEmailStyleInferTool(harness: AgentHarness) {
  return defineTool({
    name: "email_style_infer",
    description:
      "WHAT: Optional visual design hints for one outbound email — **does not write copy or HTML**.\n" +
      "WHEN: Only if the user **explicitly named** an industry or visual style this turn (R-EMAIL-CONTEXT). Otherwise skip and use neutral R-EMAIL-STYLE HTML directly.\n" +
      "HOW: Pass purpose from the user's ask only. industry/tone/brand_context only if the user stated them — harness drops fields invented from recipes or memory.\n" +
      "NOT FOR: thread replies, one-liners, plain-only mail, or default Liminal/product mail unless user named a vertical.",
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
      const userMessage = harness.getContext().getLastUserMessage() ?? "";
      const sanitized = sanitizeEmailStyleInferInput(
        {
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
        },
        userMessage
      );
      const result = await inferEmailStyle(client, model, sanitized);

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
