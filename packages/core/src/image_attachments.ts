export type ImageAttachmentSource = "clipboard" | "drop" | "path" | "command";

export interface ImageAttachment {
  name: string;
  mimeType: string;
  filePath?: string;
  dataUrl?: string;
  sizeBytes: number;
  source: ImageAttachmentSource;
}

export interface ImageAttachmentLimits {
  maxCount: number;
  maxBytesPerImage: number;
  maxTotalBytes: number;
}

export const DEFAULT_IMAGE_ATTACHMENT_LIMITS: ImageAttachmentLimits = {
  maxCount: 4,
  maxBytesPerImage: 4 * 1024 * 1024,
  maxTotalBytes: 12 * 1024 * 1024,
};

const SUPPORTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const DATA_URL_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

function stripDataUrlWhitespace(base64: string): string {
  return base64.replace(/\s+/g, "");
}

function escapeFence(value: string): string {
  return value.replace(/`/g, "'");
}

export function isSupportedImageMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function estimateBase64DecodedBytes(base64: string): number {
  const normalized = stripDataUrlWhitespace(base64);
  const len = normalized.length;
  if (len === 0) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

export function parseDataUrlImage(dataUrl: string): { ok: true; mimeType: string; sizeBytes: number } | { ok: false; error: string } {
  const trimmed = dataUrl.trim();
  const match = DATA_URL_IMAGE_RE.exec(trimmed);
  if (!match) return { ok: false, error: "Attachment must be a base64 data:image URL." };
  const mimeType = match[1]!.toLowerCase();
  if (!isSupportedImageMimeType(mimeType)) {
    return { ok: false, error: `Unsupported image MIME type "${mimeType}".` };
  }
  const sizeBytes = estimateBase64DecodedBytes(match[2]!);
  return { ok: true, mimeType, sizeBytes };
}

export function normalizeImageAttachmentName(name: string, fallback = "image"): string {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^\w.\-() ]/g, "_").slice(0, 120) || fallback;
}

export function validateImageAttachments(
  attachments: ImageAttachment[],
  limits: ImageAttachmentLimits = DEFAULT_IMAGE_ATTACHMENT_LIMITS
): { ok: true } | { ok: false; error: string } {
  if (attachments.length > limits.maxCount) {
    return { ok: false, error: `Too many images (${attachments.length}). Max ${limits.maxCount}.` };
  }
  let total = 0;
  for (const item of attachments) {
    if (!isSupportedImageMimeType(item.mimeType)) {
      return { ok: false, error: `Unsupported image MIME type "${item.mimeType}".` };
    }
    if (!item.filePath && !item.dataUrl) {
      return { ok: false, error: `Attachment "${item.name}" must include filePath or dataUrl.` };
    }
    if (item.dataUrl && !item.dataUrl.startsWith("data:image/")) {
      return { ok: false, error: `Invalid image payload for "${item.name}".` };
    }
    if (item.sizeBytes <= 0) {
      return { ok: false, error: `Image "${item.name}" appears empty.` };
    }
    if (item.sizeBytes > limits.maxBytesPerImage) {
      return {
        ok: false,
        error: `Image "${item.name}" is too large (${Math.round(item.sizeBytes / 1024)} KB).`,
      };
    }
    total += item.sizeBytes;
    if (total > limits.maxTotalBytes) {
      return {
        ok: false,
        error: `Total image payload too large (${Math.round(total / 1024)} KB).`,
      };
    }
  }
  return { ok: true };
}

export function buildMessageWithImageAttachments(message: string, attachments: ImageAttachment[]): string {
  const trimmed = message.trim();
  if (attachments.length === 0) return trimmed;
  const lines: string[] = [];
  lines.push(trimmed || "Please analyze the attached image(s).");
  lines.push("");
  lines.push("```attached_images");
  attachments.forEach((item, idx) => {
    lines.push(`- index: ${idx + 1}`);
    lines.push(`  name: ${escapeFence(item.name)}`);
    lines.push(`  mime: ${item.mimeType}`);
    lines.push(`  size_bytes: ${item.sizeBytes}`);
    lines.push(`  source: ${item.source}`);
    if (item.filePath) lines.push(`  path: ${item.filePath}`);
    if (item.dataUrl) lines.push(`  data_url: ${item.dataUrl}`);
  });
  lines.push("```");
  lines.push("If image understanding is needed, use vision_analyze with path when available (fallback: data_url).");
  return lines.join("\n");
}
