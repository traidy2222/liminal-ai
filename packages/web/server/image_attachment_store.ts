import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { normalizeImageAttachmentName, type ImageAttachment } from "@liminal/core";

function mimeToExt(mime: string): string {
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "image/gif") return ".gif";
  if (mime === "image/webp") return ".webp";
  return ".img";
}

function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Buffer.from([]);
  const base64 = dataUrl.slice(comma + 1);
  return Buffer.from(base64, "base64");
}

export async function persistIncomingAttachments(
  attachments: Array<ImageAttachment & { dataUrl: string }>
): Promise<ImageAttachment[]> {
  if (attachments.length === 0) return [];
  const root = resolve(process.env["AGENT_WORKSPACE_ROOT"]?.trim() || process.cwd());
  const dir = join(root, ".agent_artifacts", "uploads");
  await mkdir(dir, { recursive: true });
  const timestamp = Date.now();
  const stored: ImageAttachment[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const item = attachments[i]!;
    const base = normalizeImageAttachmentName(item.name.replace(/\.[^.]+$/, ""), "image");
    const ext = mimeToExt(item.mimeType);
    const filename = `${timestamp}-${i + 1}-${base}${ext}`;
    const path = join(dir, filename);
    await writeFile(path, decodeDataUrl(item.dataUrl));
    stored.push({
      name: item.name,
      mimeType: item.mimeType,
      filePath: path,
      sizeBytes: item.sizeBytes,
      source: item.source,
    });
  }
  return stored;
}
