import { defineTool } from "../../shared/helpers.js";
import { loadIR, saveIR, setRunStage, getBulletText } from "./doc_engine.js";
import type { BulletEmphasis, BulletItem } from "@liminal/core";

const VALID_LAYOUTS = ["hero", "kpi", "comparison", "timeline", "risk", "quote", "image_full", "summary", "default"] as const;
const VALID_EMPHASIS = ["accent", "muted", "heading", "normal"] as const;

function parseBulletItem(x: unknown): BulletItem | null {
  if (typeof x === "string") {
    const t = x.trim();
    return t.length > 0 ? t : null;
  }
  if (typeof x === "object" && x !== null) {
    const obj = x as Record<string, unknown>;
    const text = String(obj["text"] ?? "").trim();
    if (!text) return null;
    const emp = String(obj["emphasis"] ?? "");
    const emphasis = (VALID_EMPHASIS as readonly string[]).includes(emp) ? (emp as BulletEmphasis) : undefined;
    return emphasis ? { text, emphasis } : text;
  }
  return null;
}

export const docComposeChunkTool = defineTool({
  name: "doc_compose_chunk",
  description:
    "Compose one planned chunk into structured content for the Document IR.\n\n" +
    "─── LAYOUT SELECTION ─────────────────────────────────────────────────────────\n" +
    "Pass layout= to override keyword inference. Choose based on content type:\n" +
    "  hero        Title/opening slide. bullets[]: 0–2 subtitle/context lines. Use slide_body for subtitle paragraph.\n" +
    "  kpi         KPI dashboard. bullets[0–2] render as large metric cards. bullets[3+] go below as detail (max 8).\n" +
    "  comparison  Two-column split. Even-indexed bullets → left col, odd-indexed → right col. Max 8 (4 per side).\n" +
    "  timeline    Vertical milestone list. Max 5 bullets, ≤50 chars each. speaker_notes for extended narrative.\n" +
    "  risk        Risk/issue list. Max 6 bullets. Use emphasis='accent' for critical items.\n" +
    "  quote       Full-width pull-quote. bullets[0]: quote text, bullets[1]: attribution. Max 2 bullets.\n" +
    "  image_full  Image-dominant. bullets[0–1]: short captions only, ≤60 chars each.\n" +
    "  summary     Decision/summary slide. Max 5 bullets. slide_body for closing statement.\n" +
    "  default     Standard content slide. Max 7 bullets.\n\n" +
    "─── BULLET EMPHASIS ──────────────────────────────────────────────────────────\n" +
    "Pass bullet objects instead of plain strings to control visual weight:\n" +
    "  {\"text\": \"...\", \"emphasis\": \"accent\"}   → accent color + bold  (key stat, CTA, critical risk)\n" +
    "  {\"text\": \"...\", \"emphasis\": \"heading\"}  → heading font + bold  (sub-section label)\n" +
    "  {\"text\": \"...\", \"emphasis\": \"muted\"}    → muted color          (caveat, supporting detail)\n" +
    "  {\"text\": \"...\", \"emphasis\": \"normal\"}   → default body styling\n" +
    "  Plain string → normal emphasis.\n\n" +
    "─── SPATIAL CONSTRAINTS (WIDE 13.33\" × 7.5\") ────────────────────────────────\n" +
    "  Body box: x=0.7, y=1.35, w=11.9, h=5.25 in. Font auto-scales with line count:\n" +
    "    ≤8 lines → 21pt  |  ≤10 lines → 19pt  |  ≤12 lines → 17pt  |  overflow → 15pt + truncation\n" +
    "  Bullet wrapping: ~52 chars/line. Keep bullets ≤52 chars for single-line display.\n" +
    "  slide_body: visible footer strip x=0.95, y=6.48, w=10.9, h=0.8 in — 12pt muted. ≤200 chars.\n" +
    "  speaker_notes: notes pane ONLY — never on slide. Unlimited length. Use for presenter talking points.\n\n" +
    "─── STYLE CONTEXT ────────────────────────────────────────────────────────────\n" +
    "  Style description and palette are included in doc_plan output. Reference them when choosing\n" +
    "  which bullets to mark accent (matches accent hex) vs muted (matches muted hex).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
      chunk_id: { type: "string" },
      layout: {
        type: "string",
        description: "Explicit slide layout: hero|kpi|comparison|timeline|risk|quote|image_full|summary|default",
      },
      bullets: {
        type: "array",
        items: {},
        description: "Array of plain strings or {text, emphasis} objects. See layout constraints for max counts.",
      },
      slide_body: {
        type: "string",
        description: "Visible footer text strip on slide (≤200 chars). Closing statement, source credit, or subtitle.",
      },
      speaker_notes: {
        type: "string",
        description: "Presenter notes — goes to notes pane only, never visible on slide. Unlimited length.",
      },
      visuals: { type: "array", items: { type: "object" } },
    },
    required: ["doc_id", "chunk_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const chunkId = String(args["chunk_id"] ?? "");
    if (!docId || !chunkId) return { ok: false, error: "doc_id and chunk_id are required" };
    const doc = await loadIR(docId);
    const idx = doc.chunks.findIndex((c) => c.id === chunkId);
    if (idx < 0) return { ok: false, error: `chunk not found: ${chunkId}` };
    const prior = doc.chunks[idx]!;

    const layoutRaw = typeof args["layout"] === "string" ? args["layout"].trim() : "";
    const layout = (VALID_LAYOUTS as readonly string[]).includes(layoutRaw)
      ? (layoutRaw as typeof VALID_LAYOUTS[number])
      : prior.layout;

    const bulletsRaw = Array.isArray(args["bullets"]) ? (args["bullets"] as unknown[]) : [];
    const parsedBullets = bulletsRaw.map(parseBulletItem).filter((b): b is BulletItem => b !== null);
    const bullets = parsedBullets.length > 0
      ? parsedBullets
      : [`Core point about ${prior.title}`, "Evidence", "Action"];

    const slideBody = typeof args["slide_body"] === "string" ? args["slide_body"].trim() || undefined : prior.slide_body;
    const speakerNotes = typeof args["speaker_notes"] === "string" ? args["speaker_notes"].trim() || undefined : prior.speaker_notes;

    const visuals = Array.isArray(args["visuals"])
      ? (args["visuals"] as unknown[]).map((x) => {
          const y = x as Record<string, unknown>;
          return {
            kind: (String(y["kind"] ?? "quote") as "chart" | "image" | "table" | "quote"),
            note: typeof y["note"] === "string" ? y["note"] : undefined,
          };
        })
      : prior.visuals;

    doc.chunks[idx] = {
      ...prior,
      layout,
      bullets,
      slide_body: slideBody,
      speaker_notes: speakerNotes,
      visuals,
      status: "composed",
      lintIssues: [],
    };
    setRunStage(doc, "composing", `composed ${chunkId}`);
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);

    const emphasisCounts = bullets.reduce((acc, b) => {
      const emp = typeof b === "object" ? (b.emphasis ?? "normal") : "normal";
      acc[emp] = (acc[emp] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return {
      ok: true,
      output: JSON.stringify(
        {
          doc_id: docId,
          chunk_id: chunkId,
          status: "composed",
          layout: layout ?? "auto-infer",
          bullets: bullets.length,
          emphasis_counts: emphasisCounts,
          has_slide_body: Boolean(slideBody),
          has_speaker_notes: Boolean(speakerNotes),
          style_context: doc.styleDescription ? `Style: ${doc.styleDescription}` : undefined,
          style_palette: {
            accent: doc.style.palette.accent,
            muted: doc.style.palette.muted,
          },
        },
        null,
        2
      ),
    };
  },
});
