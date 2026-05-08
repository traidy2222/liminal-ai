import { defineTool } from "./helpers.js";
import { ensureRunState, exportPath, loadIR, saveIR, setRunStage, getBulletText } from "./doc_engine.js";
import { createRequire } from "node:module";
import type { BulletItem, DocStyleGenome, SlideLayout } from "@liminal/core";

function estimateTextLoad(lines: string[]): number {
  return lines.reduce((acc, line) => acc + Math.ceil(line.length / 52), 0);
}

function solveBodyBox(lines: string[]): { fontSize: number; maxLines: number; overflow: boolean } {
  const load = estimateTextLoad(lines);
  const maxLines = 12;
  if (load <= 8) return { fontSize: 21, maxLines, overflow: false };
  if (load <= 10) return { fontSize: 19, maxLines, overflow: false };
  if (load <= 12) return { fontSize: 17, maxLines, overflow: false };
  return { fontSize: 15, maxLines, overflow: load > maxLines };
}

/** Keyword fallback layout inference when chunk.layout is not set. */
function inferLayout(title: string, chunkId: string, idx: number): SlideLayout {
  const t = title.toLowerCase();
  if (idx === 0 || /\btitle|overview|intro\b/.test(t)) return "hero";
  if (/\bkpi|metric|growth|revenue|numbers|evidence|data\b/.test(t)) return "kpi";
  if (/\bcompare|vs|trade[- ]off|option\b/.test(t)) return "comparison";
  if (/\broadmap|timeline|phases|plan\b/.test(t)) return "timeline";
  if (/\brisk|mitigation|threat\b/.test(t)) return "risk";
  if (/\bsummary|decision|next steps|conclusion\b/.test(t)) return "summary";
  if (/\bquote|insight|highlight\b/.test(t)) return "quote";
  return idx % 2 === 0 || chunkId.endsWith("2") ? "default" : "comparison";
}

function addGlassCard(pptx: any, slide: any, x: number, y: number, w: number, h: number, fillColor: string) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    rectRadius: 0.08,
    line: { color: fillColor, transparency: 65, pt: 1 },
    fill: { color: fillColor, transparency: 84 },
  });
}

function bulletToRun(
  b: BulletItem,
  palette: DocStyleGenome["palette"],
  typography: DocStyleGenome["typography"]
): { text: string; options: Record<string, unknown> } {
  const text = getBulletText(b);
  const emphasis = typeof b === "object" ? b.emphasis : undefined;
  const color =
    emphasis === "accent" ? palette.accent.replace("#", "")
    : emphasis === "muted" ? palette.muted.replace("#", "")
    : palette.foreground.replace("#", "");
  const bold = emphasis === "accent" || emphasis === "heading";
  const fontFace = emphasis === "heading" ? typography.heading : typography.body;
  return { text, options: { bullet: { indent: 18 }, color, bold, fontFace } };
}

export const docRenderPptxTool = defineTool({
  name: "doc_render_pptx",
  description: "Render Document IR to PPTX using chunk-by-chunk slide composition with model-specified layouts and emphasis.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  resourceLocks: (args) => [`file:write:doc:${String(args["doc_id"] ?? "")}`],
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const doc = await loadIR(docId);
    ensureRunState(doc);
    setRunStage(doc, "rendering", "pptx render started");
    const req = createRequire(import.meta.url);
    const mod = req("pptxgenjs") as { default?: unknown };
    const PptxCtor = (mod.default ?? mod) as unknown as { new (): any };
    const pptx = new PptxCtor();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Liminal";
    pptx.subject = doc.objective;
    pptx.title = doc.title;

    for (const [idx, chunk] of doc.chunks.entries()) {
      const slide = pptx.addSlide();
      // Use model-specified layout, fall back to keyword inference
      const variant: SlideLayout = chunk.layout ?? inferLayout(chunk.title, chunk.id, idx);

      slide.background = { color: doc.style.palette.background.replace("#", "") };

      // Accent top bar
      slide.addShape(pptx.ShapeType.rect, {
        x: 0, y: 0, w: 13.33, h: 0.17,
        line: { color: doc.style.palette.accent.replace("#", ""), pt: 0 },
        fill: { color: doc.style.palette.accent.replace("#", ""), transparency: 10 },
      });

      // Title
      slide.addText(chunk.title, {
        x: 0.6,
        y: variant === "hero" ? 1.1 : 0.44,
        w: 12,
        h: variant === "hero" ? 1.3 : 0.8,
        fontFace: doc.style.typography.heading,
        fontSize: variant === "hero" ? doc.style.typography.scale[0] : doc.style.typography.scale[1],
        color: doc.style.palette.foreground.replace("#", ""),
        bold: true,
      });

      // Extract text lines for spatial computation
      const lines = chunk.bullets.length > 0 ? chunk.bullets.map(getBulletText) : ["(empty chunk)"];

      if (variant === "hero") {
        // Hero: objective as subtitle, bullets as context
        slide.addText(doc.objective, {
          x: 0.62, y: 2.52, w: 10.6, h: 0.9,
          fontFace: doc.style.typography.body,
          fontSize: 18,
          color: doc.style.palette.muted.replace("#", ""),
        });
        if (chunk.bullets.length > 0) {
          const heroRuns = chunk.bullets.slice(0, 2).map((b) => bulletToRun(b, doc.style.palette, doc.style.typography));
          slide.addText(heroRuns, {
            x: 0.92, y: 3.58, w: 10.7, h: 2.0,
            fontFace: doc.style.typography.body,
            fontSize: 16,
            color: doc.style.palette.foreground.replace("#", ""),
            breakLine: true,
          });
        }
      } else if (variant === "quote") {
        const quoteText = chunk.bullets[0] ? getBulletText(chunk.bullets[0]) : "";
        const attribution = chunk.bullets[1] ? getBulletText(chunk.bullets[1]) : "";
        addGlassCard(pptx, slide, 0.7, 1.35, 11.9, 4.5, doc.style.palette.foreground.replace("#", ""));
        slide.addText(`“${quoteText}”`, {
          x: 1.2, y: 2.0, w: 10.9, h: 2.8,
          fontFace: doc.style.typography.heading,
          fontSize: 26,
          color: doc.style.palette.foreground.replace("#", ""),
          align: "center",
          italic: true,
        });
        if (attribution) {
          slide.addText(`— ${attribution}`, {
            x: 1.2, y: 5.1, w: 10.9, h: 0.5,
            fontFace: doc.style.typography.body,
            fontSize: 15,
            color: doc.style.palette.muted.replace("#", ""),
            align: "right",
          });
        }
      } else if (variant === "image_full") {
        addGlassCard(pptx, slide, 0.7, 1.3, 11.9, 4.0, doc.style.palette.foreground.replace("#", ""));
        slide.addText("[ Image ]", {
          x: 0.7, y: 1.3, w: 11.9, h: 4.0,
          fontFace: doc.style.typography.body,
          fontSize: 20,
          color: doc.style.palette.muted.replace("#", ""),
          align: "center",
        });
        const captions = chunk.bullets.slice(0, 2);
        if (captions.length > 0) {
          slide.addText(captions.map((b) => getBulletText(b)).join(" · "), {
            x: 0.95, y: 5.45, w: 10.9, h: 0.55,
            fontFace: doc.style.typography.body,
            fontSize: 13,
            color: doc.style.palette.muted.replace("#", ""),
            align: "center",
          });
        }
      } else {
        // All other variants share the glass card body box
        addGlassCard(pptx, slide, 0.7, 1.35, 11.9, 5.25, doc.style.palette.foreground.replace("#", ""));

        const solved = solveBodyBox(lines);
        const fitBullets = solved.overflow ? chunk.bullets.slice(0, solved.maxLines - 1) : chunk.bullets;
        if (solved.overflow) {
          chunk.lintIssues = [...new Set([...(chunk.lintIssues ?? []), "slide_overflow_risk"])];
        }
        const bulletRuns = [
          ...fitBullets.map((b) => bulletToRun(b, doc.style.palette, doc.style.typography)),
          ...(solved.overflow
            ? [{ text: "…continued in speaker notes", options: { bullet: { indent: 18 }, color: doc.style.palette.muted.replace("#", ""), italic: true, fontFace: doc.style.typography.body } }]
            : []),
        ];

        if (variant === "kpi") {
          // Top 3 bullets → large KPI cards
          const kpiItems = fitBullets.slice(0, 3);
          kpiItems.forEach((b, i) =>
            slide.addText(getBulletText(b), {
              x: 0.95 + i * 3.9,
              y: 1.75,
              w: 3.55,
              h: 1.2,
              fontFace: doc.style.typography.heading,
              fontSize: 28,
              color:
                typeof b === "object" && b.emphasis === "accent"
                  ? doc.style.palette.accent.replace("#", "")
                  : doc.style.palette.accent.replace("#", ""),
              bold: true,
              align: "center",
            })
          );
          // Remaining as standard list
          if (bulletRuns.length > 3) {
            slide.addText(bulletRuns.slice(3), {
              x: 1.0, y: 3.35, w: 11.1, h: 2.8,
              fontFace: doc.style.typography.body,
              fontSize: Math.min(solved.fontSize, 15),
              color: doc.style.palette.foreground.replace("#", ""),
              breakLine: true,
            });
          }
        } else if (variant === "comparison") {
          const left = bulletRuns.filter((_, i) => i % 2 === 0);
          const right = bulletRuns.filter((_, i) => i % 2 === 1);
          slide.addText(left, {
            x: 1.0, y: 1.9, w: 5.0, h: 4.3,
            fontFace: doc.style.typography.body,
            fontSize: solved.fontSize,
            color: doc.style.palette.foreground.replace("#", ""),
            breakLine: true,
          });
          slide.addText(right, {
            x: 7.0, y: 1.9, w: 5.0, h: 4.3,
            fontFace: doc.style.typography.body,
            fontSize: solved.fontSize,
            color: doc.style.palette.foreground.replace("#", ""),
            breakLine: true,
          });
          slide.addShape(pptx.ShapeType.line, {
            x: 6.5, y: 1.8, w: 0, h: 4.5,
            line: { color: doc.style.palette.muted.replace("#", ""), pt: 1 },
          });
        } else if (variant === "timeline") {
          fitBullets.slice(0, 5).forEach((b, i) => {
            slide.addShape(pptx.ShapeType.ellipse, {
              x: 1.0, y: 1.6 + i * 0.95, w: 0.18, h: 0.18,
              fill: { color: doc.style.palette.accent.replace("#", "") },
              line: { color: doc.style.palette.accent.replace("#", ""), pt: 1 },
            });
            const text = getBulletText(b);
            const color =
              typeof b === "object" && b.emphasis === "accent"
                ? doc.style.palette.accent.replace("#", "")
                : typeof b === "object" && b.emphasis === "muted"
                  ? doc.style.palette.muted.replace("#", "")
                  : doc.style.palette.foreground.replace("#", "");
            slide.addText(text, {
              x: 1.35, y: 1.48 + i * 0.95, w: 10.6, h: 0.5,
              fontFace: doc.style.typography.body,
              fontSize: solved.fontSize,
              color,
              bold: typeof b === "object" && (b.emphasis === "accent" || b.emphasis === "heading"),
            });
          });
        } else {
          // risk, summary, default — standard bullet list
          slide.addText(bulletRuns, {
            x: 1.06, y: 1.68, w: 10.85, h: 4.6,
            fontFace: doc.style.typography.body,
            fontSize: solved.fontSize,
            color: doc.style.palette.foreground.replace("#", ""),
            breakLine: true,
          });
        }
      }

      // slide_body: visible footer strip (new) — fall back to narrative for compat
      const footerText = chunk.slide_body?.trim() || (!chunk.speaker_notes && chunk.narrative?.trim());
      if (footerText) {
        slide.addText(footerText, {
          x: 0.95, y: 6.48, w: 10.9, h: 0.8,
          fontFace: doc.style.typography.body,
          fontSize: 12,
          color: doc.style.palette.muted.replace("#", ""),
        });
      }

      // Speaker notes: notes pane only — prefer speaker_notes, fall back to narrative
      const notes = chunk.speaker_notes?.trim() || (chunk.slide_body ? undefined : chunk.narrative?.trim());
      if (notes) {
        slide.addNotes(notes);
      }

      chunk.status = "rendered";
    }

    const out = exportPath(docId, "pptx");
    await pptx.writeFile({ fileName: out });
    doc.exports = doc.exports.filter((e) => e.format !== "pptx");
    doc.exports.push({ format: "pptx", path: out, generatedAt: new Date().toISOString() });
    doc.updatedAt = new Date().toISOString();
    setRunStage(doc, "rendering", "pptx render complete");
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, format: "pptx", path: out }, null, 2) };
  },
});
