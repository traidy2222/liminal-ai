import { defineTool } from "../../shared/helpers.js";
import { exportPath, loadIR, saveIR } from "./doc_engine.js";
import { writeFile } from "node:fs/promises";

function toHtml(doc: Awaited<ReturnType<typeof loadIR>>): string {
  const chunks = doc.chunks
    .map((c) => {
      const bullets = c.bullets.map((b) => `<li>${b}</li>`).join("");
      const narrative = c.narrative ? `<p>${c.narrative}</p>` : "";
      return `<section><h2>${c.title}</h2><ul>${bullets}</ul>${narrative}</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html><head><meta charset="utf-8"/>
<style>
body{font-family:${doc.style.typography.body},Arial,sans-serif;margin:48px;background:${doc.style.palette.background};color:${doc.style.palette.foreground};}
h1,h2{font-family:${doc.style.typography.heading},Arial,sans-serif}
section{margin:24px 0;padding-bottom:8px;border-bottom:1px solid ${doc.style.palette.muted}}
li{margin-bottom:6px}
</style></head><body>
<h1>${doc.title}</h1><p><strong>Objective:</strong> ${doc.objective}</p>${chunks}
</body></html>`;
}

export const docRenderPdfTool = defineTool({
  name: "doc_render_pdf",
  description: "Render Document IR to PDF through HTML/CSS with page-aware typography.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      doc_id: { type: "string" },
    },
    required: ["doc_id"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const docId = String(args["doc_id"] ?? "");
    const doc = await loadIR(docId);
    const html = toHtml(doc);
    const out = exportPath(docId, "pdf");
    try {
      const playwright = await import("playwright");
      const browser = await playwright.chromium.launch();
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle" });
      await page.pdf({ path: out, printBackground: true, format: "A4", margin: { top: "18mm", bottom: "18mm", left: "14mm", right: "14mm" } });
      await browser.close();
    } catch {
      const fallback = out.replace(/\.pdf$/i, ".html");
      await writeFile(fallback, html, "utf8");
      return {
        ok: false,
        error: `PDF renderer unavailable (playwright not installed). Wrote HTML fallback: ${fallback}`,
      };
    }
    for (const chunk of doc.chunks) chunk.status = "rendered";
    doc.exports = doc.exports.filter((e) => e.format !== "pdf");
    doc.exports.push({ format: "pdf", path: out, generatedAt: new Date().toISOString() });
    doc.updatedAt = new Date().toISOString();
    await saveIR(doc);
    return { ok: true, output: JSON.stringify({ doc_id: docId, format: "pdf", path: out }, null, 2) };
  },
});

