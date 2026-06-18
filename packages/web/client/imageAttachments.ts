export type ImageAttachmentSource = "clipboard" | "drop" | "path" | "command";

/** Composer attachment (images + any other file). */
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

export const DEFAULT_CHAT_ATTACHMENT_LIMITS = {
  maxImageCount: 4,
  maxFileCount: 8,
  maxTotalCount: 12,
  maxImageBytes: 4 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

const DATA_URL_IMAGE_RE = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;
const DATA_URL_ANY_RE = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i;

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

export function isImageAttachmentMime(mimeType: string): boolean {
  return SUPPORTED_IMAGE_MIME_TYPES.has(mimeType.trim().toLowerCase());
}

export function isImageComposerAttachment(item: Pick<ImageAttachment, "mimeType">): boolean {
  return isImageAttachmentMime(item.mimeType);
}

export function parseDataUrlAttachment(
  dataUrl: string
): { ok: true; mimeType: string; sizeBytes: number } | { ok: false; error: string } {
  const trimmed = dataUrl.trim();
  const match = DATA_URL_ANY_RE.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Attachment must be a base64 data URL." };
  }
  const mimeType = match[1]!.trim().toLowerCase();
  if (!mimeType) {
    return { ok: false, error: "Attachment MIME type is missing." };
  }
  const sizeBytes = estimateBase64DecodedBytes(match[2]!);
  if (sizeBytes <= 0) {
    return { ok: false, error: "Attachment appears empty." };
  }
  return { ok: true, mimeType, sizeBytes };
}

export function parseDataUrlImage(dataUrl: string): { ok: true; mimeType: string; sizeBytes: number } | { ok: false; error: string } {
  const parsed = parseDataUrlAttachment(dataUrl);
  if (!parsed.ok) return parsed;
  if (!isImageAttachmentMime(parsed.mimeType)) {
    return { ok: false, error: `Unsupported image MIME type "${parsed.mimeType}".` };
  }
  return parsed;
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
    if (!isImageAttachmentMime(item.mimeType)) {
      return { ok: false, error: `Unsupported image MIME type "${item.mimeType}".` };
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

export function validateComposerAttachments(
  attachments: ImageAttachment[],
  limits: typeof DEFAULT_CHAT_ATTACHMENT_LIMITS = DEFAULT_CHAT_ATTACHMENT_LIMITS
): { ok: true } | { ok: false; error: string } {
  if (attachments.length > limits.maxTotalCount) {
    return { ok: false, error: `Too many attachments (${attachments.length}). Max ${limits.maxTotalCount}.` };
  }
  const images = attachments.filter(isImageComposerAttachment);
  const files = attachments.filter((a) => !isImageComposerAttachment(a));
  if (images.length > limits.maxImageCount) {
    return { ok: false, error: `Too many images (${images.length}). Max ${limits.maxImageCount}.` };
  }
  if (files.length > limits.maxFileCount) {
    return { ok: false, error: `Too many files (${files.length}). Max ${limits.maxFileCount}.` };
  }
  let total = 0;
  for (const item of attachments) {
    const maxOne = isImageComposerAttachment(item) ? limits.maxImageBytes : limits.maxFileBytes;
    if (item.sizeBytes <= 0) {
      return { ok: false, error: `"${item.name}" appears empty.` };
    }
    if (item.sizeBytes > maxOne) {
      return { ok: false, error: `"${item.name}" is too large.` };
    }
    total += item.sizeBytes;
    if (total > limits.maxTotalBytes) {
      return { ok: false, error: "Total attachment payload too large." };
    }
  }
  return { ok: true };
}
