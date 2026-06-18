import {
  buildMessageWithFileAttachments,
  buildMessageWithImageAttachments,
  normalizeChatAttachmentName,
  parseDataUrlAttachment,
  partitionChatAttachments,
  validateChatAttachments,
  DEFAULT_CHAT_ATTACHMENT_LIMITS,
  type ChatFileAttachment,
} from "@liminal/core";
import type { WireChatAttachment } from "@liminal/protocol";

export function normalizeWireChatAttachments(
  attachments: WireChatAttachment[] | undefined
): { ok: true; attachments: Array<ChatFileAttachment & { dataUrl: string }> } | { ok: false; error: string } {
  const normalized: Array<ChatFileAttachment & { dataUrl: string }> = [];
  for (const item of attachments ?? []) {
    const dataUrl = String(item?.dataUrl ?? "").trim();
    const parsed = parseDataUrlAttachment(dataUrl);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const declaredMime = String(item?.mimeType ?? "").trim().toLowerCase();
    const mimeType = declaredMime || parsed.mimeType;
    normalized.push({
      name: normalizeChatAttachmentName(String(item?.name ?? "file")),
      mimeType,
      dataUrl,
      sizeBytes: parsed.sizeBytes,
      source: item?.source ?? "clipboard",
    });
  }
  const validation = validateChatAttachments(normalized, DEFAULT_CHAT_ATTACHMENT_LIMITS);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, attachments: normalized };
}

/** @deprecated use normalizeWireChatAttachments */
export const normalizeWireAttachments = normalizeWireChatAttachments;

export function partitionNormalizedAttachments(
  attachments: Array<ChatFileAttachment & { dataUrl: string }>
): { images: Array<ChatFileAttachment & { dataUrl: string }>; files: Array<ChatFileAttachment & { dataUrl: string }> } {
  return partitionChatAttachments(attachments);
}

export function buildOutboundUserMessage(
  message: string,
  attachments: Array<ChatFileAttachment & { dataUrl: string }>
): string {
  const { images, files } = partitionChatAttachments(attachments);
  if (images.length === 0 && files.length === 0) return message.trim();
  if (images.length > 0 && files.length === 0) {
    return buildMessageWithImageAttachments(message.trim(), images);
  }
  if (files.length > 0 && images.length === 0) {
    return buildMessageWithFileAttachments(message.trim(), files);
  }
  const withFiles = buildMessageWithFileAttachments(message.trim(), files);
  return buildMessageWithImageAttachments(withFiles, images);
}
