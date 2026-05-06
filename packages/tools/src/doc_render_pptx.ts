import { defineTool } from "./helpers.js";
import { ensureRunState, exportPath, loadIR, saveIR, setRunStage } from "./doc_engine.js";
import { createRequire } from "node:module";

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

type SlideVariant = "hero" | "kpi" | "comparison" | "timeline" | "risk" | "summary" | "default";

function chooseVariant(title: string, chunkId: string, idx: number): SlideVariant {
  const t = title.toLowerCase();
  if (idx === 0 || /\btitle|overview|intro\b/.test(t)) return "hero";
  if (/\bkpi|metric|growth|revenue|numbers|evidence|data\b/.test(t)) return "kpi";
  if (/\bcompare|vs|trade[- ]off|option\b/.test(t)) return "comparison";
  if (/\broadmap|timeline|phases|plan\b/.test(t)) return "timeline";
  if (/\brisk|mitigation|threat\b/.test(t)) return "risk";
  if (/\bsummary|decision|next steps|conclusion\b/.test(t)) return "summary";
  return idx % 2 === 0 || chunkId.endsWith("2") ? "default" : "comparison";
}

function addGlassCard(pptx: any, slide: any, x: number, y: number, w: number, h: number, fillColor: string) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.08,
    line: { color: fillColor, transparency: 65, pt: 1 },
    fill: { color: fillColor, transparency: 84 },
  });
}

export const docRenderPptxTool = defineTool({
  name: "doc_render_pptx",
  description: "Render Document IR to PPTX using chunk-by-chunk slide composition.",
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
      const variant = chooseVariant(chunk.title, chunk.id, idx);
      slide.background = { color: doc.style.palette.background.replace("#", "") };
      slide.addShape(pptx.ShapeType.rect, {
        x: 0,
        y: 0,
        w: 13.33,
        h: 0.17,
        line: { color: doc.style.palette.accent.replace("#", ""), pt: 0 },
        fill: { color: doc.style.palette.accent.replace("#", ""), transparency: 10 },
      });
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
      if (variant === "hero") {
        slide.addText(doc.objective, {
          x: 0.62,
          y: 2.52,
          w: 10.6,
          h: 0.9,
          fontFace: doc.style.typography.body,
          fontSize: 18,
          color: doc.style.palette.muted.replace("#", ""),
        });
      }
      const lines = chunk.bullets.length > 0 ? chunk.bullets : ["(empty chunk)"];
      const solved = solveBodyBox(lines);
      const fitLines = solved.overflow ? lines.slice(0, solved.maxLines - 1).concat("...continued in speaker notes") : lines;
      if (solved.overflow) {
        chunk.lintIssues = [...new Set([...(chunk.lintIssues ?? []), "slide_overflow_risk"])];
      }
      if (variant !== "hero") {
        addGlassCard(pptx, slide, 0.7, 1.35, 11.9, 5.25, doc.style.palette.foreground.replace("#", ""));
      }
      const bulletRuns = fitLines.map((t) => ({ text: t, options: { bullet: { indent: 18 } } }));
      if (variant === "kpi") {
        const top = fitLines.slice(0, 3);
        top.forEach((t, i) =>
          slide.addText(t, {
            x: 0.95 + i * 3.9,
            y: 1.75,
            w: 3.55,
            h: 1.2,
            fontFace: doc.style.typography.heading,
            fontSize: 28,
            color: doc.style.palette.accent.replace("#", ""),
            bold: true,
            align: "center",
          })
        );
        slide.addText(bulletRuns.slice(3), {
          x: 1.0,
          y: 3.35,
          w: 11.1,
          h: 2.8,
          fontFace: doc.style.typography.body,
          fontSize: 15,
          color: doc.style.palette.foreground.replace("#", ""),
          breakLine: true,
        });
      } else if (variant === "comparison") {
        const left = bulletRuns.filter((_, i) => i % 2 === 0);
        const right = bulletRuns.filter((_, i) => i % 2 === 1);
        slide.addText(left, {
          x: 1.0,
          y: 1.9,
          w: 5.0,
          h: 4.3,
          fontFace: doc.style.typography.body,
          fontSize: 15,
          color: doc.style.palette.foreground.replace("#", ""),
          breakLine: true,
        });
        slide.addText(right, {
          x: 7.0,
          y: 1.9,
          w: 5.0,
          h: 4.3,
          fontFace: doc.style.typography.body,
          fontSize: 15,
          color: doc.style.palette.foreground.replace("#", ""),
          breakLine: true,
        });
        slide.addShape(pptx.ShapeType.line, {
          x: 6.5,
          y: 1.8,
          w: 0,
          h: 4.5,
          line: { color: doc.style.palette.muted.replace("#", ""), pt: 1 },
        });
      } else if (variant === "timeline") {
        fitLines.slice(0, 5).forEach((t, i) => {
          slide.addShape(pptx.ShapeType.ellipse, {
            x: 1.0,
            y: 1.6 + i * 0.95,
            w: 0.18,
            h: 0.18,
            fill: { color: doc.style.palette.accent.replace("#", "") },
            line: { color: doc.style.palette.accent.replace("#", ""), pt: 1 },
          });
          slide.addText(t, {
            x: 1.35,
            y: 1.48 + i * 0.95,
            w: 10.6,
            h: 0.5,
            fontFace: doc.style.typography.body,
            fontSize: 15,
            color: doc.style.palette.foreground.replace("#", ""),
          });
        });
      } else {
        slide.addText(bulletRuns, {
          x: variant === "hero" ? 0.92 : 1.06,
          y: variant === "hero" ? 3.58 : 1.68,
          w: variant === "hero" ? 10.7 : 10.85,
          h: variant === "hero" ? 2.85 : 4.6,
          fontFace: doc.style.typography.body,
          fontSize: variant === "hero" ? Math.max(14, solved.fontSize - 1) : solved.fontSize,
          color: doc.style.palette.foreground.replace("#", ""),
          breakLine: true,
        });
      }
      if (chunk.narrative?.trim()) {
        slide.addText(chunk.narrative, {
          x: 0.95,
          y: 6.48,
          w: 10.9,
          h: 0.8,
          fontFace: doc.style.typography.body,
          fontSize: 12,
          color: doc.style.palette.muted.replace("#", ""),
        });
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

