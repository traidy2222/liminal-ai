import { defineTool } from "../../shared/helpers.js";
import {
  buildInitialChunks,
  saveIR,
  synthesizeStyleGenome,
  defaultOutlineFromObjective,
  saveStyleSignature,
  ensureRunState,
  setRunStage,
} from "./doc_engine.js";
import { isStyleDiverseEnough } from "./doc_style_memory.js";
import { resolveProviderConfig, withProviderRequestSpacing, effectiveHarnessEnvRaw, buildOpenRouterAttributionHeaders } from "@liminal/core";
import type { DocumentIR } from "@liminal/core";

function makeDocId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return `doc-${slug || "untitled"}-${Date.now().toString(36)}`;
}

const ALLOWED_FONTS = ["Aptos Display", "Aptos", "Segoe UI", "Calibri", "Georgia", "Open Sans", "Roboto"];

async function synthesizeStyleFromIntent(
  intent: string,
  title: string,
  audience: string,
  tone: string
): Promise<{ palette?: { background: string; foreground: string; accent: string; muted: string }; heading?: string; body?: string; description?: string }> {
  try {
    const provider = resolveProviderConfig();
    const fastModel = effectiveHarnessEnvRaw("AGENT_FAST_MODEL")?.trim() || provider.model;
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await withProviderRequestSpacing(
        { apiKey: provider.apiKey, baseURL: provider.baseURL },
        () =>
          fetch(`${provider.baseURL.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${provider.apiKey}`,
              ...buildOpenRouterAttributionHeaders("doc-style"),
            },
            body: JSON.stringify({
              model: fastModel,
              temperature: 0.4,
              max_tokens: 320,
              response_format: { type: "json_object" },
              messages: [
                {
                  role: "system",
                  content:
                    `You are a presentation design system. Given a style intent, return concrete hex colors and font choices as strict JSON.\n` +
                    `Allowed fonts: ${ALLOWED_FONTS.join(", ")}.\n` +
                    `Return ONLY valid JSON with keys: background (6-digit hex), foreground (6-digit hex), accent (6-digit hex), muted (6-digit hex), heading (font name from allowed list), body (font name from allowed list), description (one concise sentence like "Dark navy + gold accent for premium finance").`,
                },
                {
                  role: "user",
                  content: `Style intent: "${intent}"\nPresentation title: "${title}", audience: "${audience}", tone: "${tone}"\nReturn colors that match the style intent with high contrast (foreground vs background ratio ≥4.5:1).`,
                },
              ],
            }),
            signal: controller.signal,
          })
      );
      clearTimeout(tid);
      if (!res.ok) return {};
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content?.trim() ?? "{}";
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const hexRe = /^#[0-9a-fA-F]{6}$/;
      const bg = typeof parsed["background"] === "string" && hexRe.test(parsed["background"]) ? parsed["background"] : null;
      const fg = typeof parsed["foreground"] === "string" && hexRe.test(parsed["foreground"]) ? parsed["foreground"] : null;
      const ac = typeof parsed["accent"] === "string" && hexRe.test(parsed["accent"]) ? parsed["accent"] : null;
      const mu = typeof parsed["muted"] === "string" && hexRe.test(parsed["muted"]) ? parsed["muted"] : null;
      const out: ReturnType<typeof synthesizeStyleFromIntent> extends Promise<infer U> ? U : never = {};
      if (bg && fg && ac && mu) out.palette = { background: bg, foreground: fg, accent: ac, muted: mu };
      if (typeof parsed["heading"] === "string" && ALLOWED_FONTS.includes(parsed["heading"])) out.heading = parsed["heading"];
      if (typeof parsed["body"] === "string" && ALLOWED_FONTS.includes(parsed["body"])) out.body = parsed["body"];
      if (typeof parsed["description"] === "string" && parsed["description"].length > 4) out.description = String(parsed["description"]);
      return out;
    } finally {
      clearTimeout(tid);
    }
  } catch {
    return {};
  }
}

export const docPlanTool = defineTool({
  name: "doc_plan",
  description:
    "Create Document IR plan with semantic outline, style genome, and chunk scaffold for progressive composition.\n" +
    "Supports format targets: pptx (ppx alias), docx, pdf.\n\n" +
    "STYLE INTENT: Pass style_intent as a natural-language description of the desired visual style.\n" +
    "Examples: \"dark navy with gold accent, premium finance\", \"bright minimal SaaS, blue/white\", \"bold startup pitch, gradient purple\"\n" +
    "The model will synthesize a concrete palette and typography from the intent. Falls back to hash-based style if unavailable.\n\n" +
    "OUTPUT includes style_palette (hex colors), style_description, and layout_constraints per layout type so you\n" +
    "can make informed layout choices when calling doc_compose_chunk.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string" },
      objective: { type: "string" },
      topic: { type: "string" },
      audience: { type: "string" },
      tone: { type: "string" },
      style_intent: {
        type: "string",
        description: "Natural-language visual style description. E.g. 'dark premium finance, navy/gold'. Drives LLM palette synthesis.",
      },
      autonomy_mode: { type: "string" },
      narrative_beats: { type: "array", items: { type: "string" } },
      format_targets: {
        type: "array",
        items: { type: "string" },
      },
      semantic_outline: {
        type: "array",
        items: { type: "string" },
      },
    },
    required: ["title"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const normalizeFormat = (raw: string): "pptx" | "docx" | "pdf" | null => {
      const v = raw.trim().toLowerCase();
      if (v === "ppx") return "pptx";
      if (v === "pptx" || v === "docx" || v === "pdf") return v;
      return null;
    };
    const title = String(args["title"] ?? "").trim();
    const topic = String(args["topic"] ?? "").trim();
    const objective = String((args["objective"] ?? topic) || title).trim();
    const audience = String(args["audience"] ?? "general").trim();
    const tone = String(args["tone"] ?? "professional").trim();
    const styleIntent = typeof args["style_intent"] === "string" ? args["style_intent"].trim() : "";
    const autonomyMode = String(args["autonomy_mode"] ?? "max") as "max" | "guided" | "strict";
    const narrativeBeats = Array.isArray(args["narrative_beats"])
      ? (args["narrative_beats"] as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];
    const formatTargetsRaw = Array.isArray(args["format_targets"]) ? (args["format_targets"] as unknown[]) : ["pptx"];
    const formatTargets = formatTargetsRaw
      .map((x) => normalizeFormat(String(x)))
      .filter((x): x is "pptx" | "docx" | "pdf" => x !== null);
    const outlineProvided = (Array.isArray(args["semantic_outline"]) ? args["semantic_outline"] : [])
      .map((x) => String(x).trim())
      .filter(Boolean);
    const outline = outlineProvided.length > 0 ? outlineProvided : defaultOutlineFromObjective(objective);
    if (!title || !objective || outline.length === 0) {
      return { ok: false, error: "title is required and objective/outline must resolve to non-empty content" };
    }
    const id = makeDocId(title);
    const styleSeed = `${title}|${audience}|${tone}|${objective}`;
    let style = synthesizeStyleGenome(styleSeed);
    if (!(await isStyleDiverseEnough(style))) {
      style = synthesizeStyleGenome(`${styleSeed}|${Date.now()}`);
    }

    // LLM-driven style override when style_intent is provided
    let styleDescription: string | undefined;
    if (styleIntent) {
      const llmStyle = await synthesizeStyleFromIntent(styleIntent, title, audience, tone);
      if (llmStyle.palette) style.palette = llmStyle.palette;
      if (llmStyle.heading) style.typography = { ...style.typography, heading: llmStyle.heading };
      if (llmStyle.body) style.typography = { ...style.typography, body: llmStyle.body };
      styleDescription = llmStyle.description ?? styleIntent;
      style.description = styleDescription;
    } else {
      styleDescription = `Auto-generated — bg:${style.palette.background} accent:${style.palette.accent}`;
    }

    const now = new Date().toISOString();
    const doc: DocumentIR = {
      id,
      createdAt: now,
      updatedAt: now,
      title,
      objective,
      audience,
      tone,
      autonomyMode,
      formatTargets: formatTargets.length > 0 ? formatTargets : ["pptx"],
      semanticOutline: outline,
      narrativeBeats,
      chunks: buildInitialChunks(outline),
      style,
      styleDescription,
      claimSources: [],
      sourceMap: [],
      assetSelections: [],
      chartData: [],
      lintHistory: [],
      repairHistory: [],
      exports: [],
    };
    ensureRunState(doc);
    setRunStage(doc, "planned", "doc_plan created initial IR");
    await saveIR(doc);
    await saveStyleSignature(id, style);
    return {
      ok: true,
      output: JSON.stringify(
        {
          doc_id: id,
          chunks: doc.chunks.map((c) => ({ id: c.id, title: c.title, status: c.status })),
          style_genome_id: style.id,
          style_description: styleDescription,
          style_palette: {
            background: style.palette.background,
            foreground: style.palette.foreground,
            accent: style.palette.accent,
            muted: style.palette.muted,
          },
          layout_constraints: {
            hero: "bullets: 0–2 context lines, slide_body: subtitle paragraph",
            kpi: "bullets[0–2]: KPI metric cards (large text), bullets[3+]: supporting detail (max 8 total)",
            comparison: "bullets: max 8, even-indexed → left col, odd-indexed → right col (4 per side)",
            timeline: "bullets: max 5 milestones, ≤50 chars each — use speaker_notes for extended detail",
            risk: "bullets: max 6, use emphasis='accent' for high-severity items",
            quote: "bullets[0]: quote text, bullets[1]: attribution — max 2 bullets",
            image_full: "bullets: 1–2 short captions only (≤60 chars each)",
            summary: "bullets: max 5, slide_body: 1–2 sentence closing statement",
            default: "bullets: max 7",
          },
          spatial_notes: "Body box: 11.9×5.25in. Each bullet wraps at ~52 chars/line. Font auto-scales: 8 lines→21pt, 12→17pt, overflow→15pt. slide_body renders as 12pt muted footer strip. speaker_notes go to notes pane only.",
        },
        null,
        2
      ),
    };
  },
});
