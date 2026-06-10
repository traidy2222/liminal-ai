import { defineTool } from "../../shared/helpers.js";
import { exportPath, loadIR, saveIR } from "./doc_engine.js";
import { Document, HeadingLevel, Packer, Paragraph, TextRun } from "docx";
import { writeFile } from "node:fs/promises";

export const docRenderDocxTool = defineTool({
  name: "doc_render_docx",
  description: "Render Document IR to DOCX with section-oriented long-form structure.",
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
    const ir = await loadIR(docId);
    const children: Paragraph[] = [
      new Paragraph({
        heading: HeadingLevel.TITLE,
        children: [new TextRun({ text: ir.title, bold: true })],
      }),
      new Paragraph({
        children: [new TextRun({ text: `Objective: ${ir.objective}` })],
      }),
    ];
    for (const chunk of ir.chunks) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun({ text: chunk.title, bold: true })],
        })
      );
      for (const b of chunk.bullets) {
        const text = typeof b === "string" ? b : b.text;
        children.push(
          new Paragraph({
            text,
            bullet: { level: 0 },
          })
        );
      }
      const visibleText = chunk.slide_body?.trim() || chunk.narrative?.trim();
      if (visibleText) {
        children.push(new Paragraph({ text: visibleText }));
      }
      chunk.status = "rendered";
    }
    const doc = new Document({
      sections: [{ children }],
    });
    const out = exportPath(docId, "docx");
    const buf = await Packer.toBuffer(doc);
    await writeFile(out, buf);
    ir.exports = ir.exports.filter((e) => e.format !== "docx");
    ir.exports.push({ format: "docx", path: out, generatedAt: new Date().toISOString() });
    ir.updatedAt = new Date().toISOString();
    await saveIR(ir);
    return { ok: true, output: JSON.stringify({ doc_id: docId, format: "docx", path: out }, null, 2) };
  },
});

