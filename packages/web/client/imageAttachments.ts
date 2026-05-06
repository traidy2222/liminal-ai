export type ImageAttachmentSource = "clipboard" | "drop" | "path" | "command";

export interface ImageAttachment {
  name: string;
  mimeType: string;
  dataUrl: string;
  sizeBytes: number;
  source: ImageAttachmentSource;
}

export const DEFAULT_IMAGE_ATTACHMENT_LIMITS = {
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

function estimateBase64DecodedBytes(base64: string): number {
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
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    return { ok: false, error: `Unsupported image MIME type "${mimeType}".` };
  }
  return { ok: true, mimeType, sizeBytes: estimateBase64DecodedBytes(match[2]!) };
}

export function normalizeImageAttachmentName(name: string, fallback = "image"): string {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  return trimmed.replace(/[^\w.\-() ]/g, "_").slice(0, 120) || fallback;
}

export function validateImageAttachments(
  attachments: ImageAttachment[],
  limits: typeof DEFAULT_IMAGE_ATTACHMENT_LIMITS = DEFAULT_IMAGE_ATTACHMENT_LIMITS
): { ok: true } | { ok: false; error: string } {
  if (attachments.length > limits.maxCount) {
    return { ok: false, error: `Too many images (${attachments.length}). Max ${limits.maxCount}.` };
  }
  let total = 0;
  for (const item of attachments) {
    if (!SUPPORTED_MIME_TYPES.has(item.mimeType)) {
      return { ok: false, error: `Unsupported image MIME type "${item.mimeType}".` };
    }
    if (!item.dataUrl.startsWith("data:image/")) {
      return { ok: false, error: `Invalid image payload for "${item.name}".` };
    }
    if (item.sizeBytes <= 0) {
      return { ok: false, error: `Image "${item.name}" appears empty.` };
    }
    if (item.sizeBytes > limits.maxBytesPerImage) {
      return { ok: false, error: `Image "${item.name}" is too large.` };
    }
    total += item.sizeBytes;
    if (total > limits.maxTotalBytes) {
      return { ok: false, error: "Total image payload too large." };
    }
  }
  return { ok: true };
}
