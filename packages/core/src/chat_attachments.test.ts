import { describe, expect, it } from "vitest";
import {
  buildMessageWithFileAttachments,
  partitionChatAttachments,
  parseDataUrlAttachment,
  validateChatAttachments,
} from "./chat_attachments.js";

const tinyPdf = "data:application/pdf;base64,JVBERi0xLjQK";

describe("parseDataUrlAttachment", () => {
  it("accepts non-image mime types", () => {
    const r = parseDataUrlAttachment(tinyPdf);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mimeType).toBe("application/pdf");
  });
});

describe("partitionChatAttachments", () => {
  it("splits images and files", () => {
    const { images, files } = partitionChatAttachments([
      { mimeType: "image/png" },
      { mimeType: "application/pdf" },
    ]);
    expect(images).toHaveLength(1);
    expect(files).toHaveLength(1);
  });
});

describe("buildMessageWithFileAttachments", () => {
  it("includes workspace path", () => {
    const msg = buildMessageWithFileAttachments("review this", [
      {
        name: "spec.pdf",
        mimeType: "application/pdf",
        filePath: ".agent_artifacts/uploads/spec.pdf",
        sizeBytes: 100,
        source: "drop",
      },
    ]);
    expect(msg).toContain("```attached_files");
    expect(msg).toContain("path: .agent_artifacts/uploads/spec.pdf");
  });
});

describe("validateChatAttachments", () => {
  it("rejects too many files", () => {
    const files = Array.from({ length: 9 }, (_, i) => ({
      name: `f${i}.txt`,
      mimeType: "text/plain",
      dataUrl: "data:text/plain;base64,YQ==",
      sizeBytes: 1,
      source: "drop" as const,
    }));
    const r = validateChatAttachments(files);
    expect(r.ok).toBe(false);
  });
});
