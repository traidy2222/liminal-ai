/**
 * Generic chat file attachments (any MIME) — persisted to workspace for tool access.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import {
  buildMessageWithImageAttachments,
  isSupportedImageMimeType,
  normalizeImageAttachmentName,
  resolveUserTurnWithAttachments,
  type ImageAttachment,
  type ImageAttachmentSource,
  type UserTurnContent,
} from "./image_attachments.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

export type { ImageAttachmentSource as ChatAttachmentSource };

export interface ChatFileAttachment {
  name: string;
  mimeType: string;
  filePath?: string;
  dataUrl?: string;
  sizeBytes: number;
  source: ImageAttachmentSource;
}

export interface ChatAttachmentLimits {
  maxImageCount: number;
  maxFileCount: number;
  maxTotalCount: number;
  maxImageBytes: number;
  maxFileBytes: number;
  maxTotalBytes: number;
}

export const DEFAULT_CHAT_ATTACHMENT_LIMITS: ChatAttachmentLimits = {
  maxImageCount: 4,
  maxFileCount: 8,
  maxTotalCount: 12,
  maxImageBytes: 4 * 1024 * 1024,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 64 * 1024 * 1024,
};

const DATA_URL_RE = /^data:([^;,]+);base64,([a-z0-9+/=\s]+)$/i;

function stripDataUrlWhitespace(base64: string): string {
  return base64.replace(/\s+/g, "");
}

export function estimateBase64DecodedBytes(base64: string): number {
  const normalized = stripDataUrlWhitespace(base64);
  const len = normalized.length;
  if (len === 0) return 0;
  const padding = normalized.endsWith("==") ? 2 : normalized.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((len * 3) / 4) - padding);
}

export function decodeDataUrl(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return Buffer.from([]);
  return Buffer.from(dataUrl.slice(comma + 1), "base64");
}

export function parseDataUrlAttachment(
  dataUrl: string
): { ok: true; mimeType: string; sizeBytes: number } | { ok: false; error: string } {
  const trimmed = dataUrl.trim();
  const match = DATA_URL_RE.exec(trimmed);
  if (!match) {
    return { ok: false, error: "Attachment must be a base64 data URL (data:<mime>;base64,...)." };
  }
  const mimeType = match[1]!.trim().toLowerCase();
  if (!mimeType) {
    return { ok: false, error: "Attachment MIME type is missing." };
  }
  const sizeBytes = estimateBase64DecodedBytes(match[2]!);
  if (sizeBytes <= 0) {
    return { ok: false, error: "Attachment payload appears empty." };
  }
  return { ok: true, mimeType, sizeBytes };
}

export function normalizeChatAttachmentName(name: string, fallback = "file"): string {
  return normalizeImageAttachmentName(name, fallback);
}

export function isChatImageAttachment(item: Pick<ChatFileAttachment, "mimeType">): boolean {
  return isSupportedImageMimeType(item.mimeType);
}

export function partitionChatAttachments<T extends Pick<ChatFileAttachment, "mimeType">>(
  attachments: readonly T[]
): { images: T[]; files: T[] } {
  const images: T[] = [];
  const files: T[] = [];
  for (const item of attachments) {
    if (isChatImageAttachment(item)) images.push(item);
    else files.push(item);
  }
  return { images, files };
}

export function validateChatAttachments(
  attachments: ChatFileAttachment[],
  limits: ChatAttachmentLimits = DEFAULT_CHAT_ATTACHMENT_LIMITS
): { ok: true } | { ok: false; error: string } {
  if (attachments.length > limits.maxTotalCount) {
    return {
      ok: false,
      error: `Too many attachments (${attachments.length}). Max ${limits.maxTotalCount}.`,
    };
  }
  const { images, files } = partitionChatAttachments(attachments);
  if (images.length > limits.maxImageCount) {
    return {
      ok: false,
      error: `Too many images (${images.length}). Max ${limits.maxImageCount}.`,
    };
  }
  if (files.length > limits.maxFileCount) {
    return {
      ok: false,
      error: `Too many files (${files.length}). Max ${limits.maxFileCount}.`,
    };
  }

  let total = 0;
  for (const item of attachments) {
    if (!item.filePath && !item.dataUrl) {
      return { ok: false, error: `Attachment "${item.name}" must include filePath or dataUrl.` };
    }
    const maxOne = isChatImageAttachment(item) ? limits.maxImageBytes : limits.maxFileBytes;
    if (item.sizeBytes > maxOne) {
      return {
        ok: false,
        error: `"${item.name}" is too large (${Math.round(item.sizeBytes / (1024 * 1024))} MB).`,
      };
    }
    total += item.sizeBytes;
    if (total > limits.maxTotalBytes) {
      return {
        ok: false,
        error: `Total attachment payload too large (${Math.round(total / (1024 * 1024))} MB).`,
      };
    }
  }
  return { ok: true };
}

function mimeToExt(mime: string, filename: string): string {
  const fromName = extname(filename);
  if (fromName && fromName.length <= 12) return fromName.toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
    "text/plain": ".txt",
    "text/csv": ".csv",
    "application/json": ".json",
    "application/zip": ".zip",
  };
  return map[mime] ?? ".bin";
}

/** Write data-url attachments to `.agent_artifacts/uploads/` for tool paths. */
export async function persistChatAttachmentsToWorkspace(
  attachments: ChatFileAttachment[],
  workspaceRoot?: string
): Promise<ChatFileAttachment[]> {
  if (attachments.length === 0) return [];
  const root = workspaceRoot ?? resolveWorkspaceRoot();
  const dir = join(root, ".agent_artifacts", "uploads");
  await mkdir(dir, { recursive: true });
  const timestamp = Date.now();
  const stored: ChatFileAttachment[] = [];

  for (let i = 0; i < attachments.length; i++) {
    const item = attachments[i]!;
    if (item.filePath?.trim()) {
      stored.push({ ...item });
      continue;
    }
    const dataUrl = item.dataUrl?.trim();
    if (!dataUrl) {
      stored.push({ ...item });
      continue;
    }
    const base = normalizeChatAttachmentName(item.name.replace(/\.[^.]+$/, ""), "upload");
    const ext = mimeToExt(item.mimeType, item.name);
    const filename = `${timestamp}-${i + 1}-${base}${ext}`;
    const absPath = join(dir, filename);
    await writeFile(absPath, decodeDataUrl(dataUrl));
    const filePath = relative(root, absPath) || filename;
    stored.push({
      ...item,
      filePath,
      dataUrl: undefined,
    });
  }
  return stored;
}

function escapeFence(value: string): string {
  return value.replace(/`/g, "'");
}

export function buildMessageWithFileAttachments(
  message: string,
  files: ChatFileAttachment[]
): string {
  const trimmed = message.trim();
  if (files.length === 0) return trimmed;
  const lines: string[] = [];
  lines.push(trimmed || "Please use the attached file(s).");
  lines.push("");
  lines.push("```attached_files");
  for (const item of files) {
    lines.push(`- name: ${escapeFence(item.name)}`);
    lines.push(`  mime: ${item.mimeType}`);
    lines.push(`  size_bytes: ${item.sizeBytes}`);
    lines.push(`  source: ${item.source}`);
    if (item.filePath) lines.push(`  path: ${item.filePath}`);
    else if (item.dataUrl) lines.push(`  data_url: ${item.dataUrl}`);
  }
  lines.push("```");
  lines.push(
    "ATTACHED FILES: Workspace-relative paths above are readable with read_file / grep_file / file_metadata. " +
      "For PDFs and office docs use doc_* tools when appropriate; for images use vision_analyze; " +
      "for audio use transcribe_audio. Do not assume file contents without reading them."
  );
  return lines.join("\n");
}

export async function resolveUserTurnWithChatAttachments(
  message: string,
  attachments: ChatFileAttachment[],
  modelSlug: string
): Promise<UserTurnContent> {
  const { images, files } = partitionChatAttachments(attachments);
  const imageItems: ImageAttachment[] = images.map((item) => ({
    name: item.name,
    mimeType: item.mimeType,
    filePath: item.filePath,
    dataUrl: item.dataUrl,
    sizeBytes: item.sizeBytes,
    source: item.source,
  }));
  let content = message.trim();
  if (files.length > 0) {
    content = buildMessageWithFileAttachments(content, files);
  }
  if (imageItems.length > 0) {
    return resolveUserTurnWithAttachments(content, imageItems, modelSlug);
  }
  return content;
}
