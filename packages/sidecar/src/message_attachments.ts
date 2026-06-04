import {
  buildMessageWithImageAttachments,
  normalizeImageAttachmentName,
  parseDataUrlImage,
  validateImageAttachments,
  DEFAULT_IMAGE_ATTACHMENT_LIMITS,
  type ImageAttachment,
} from "@liminal/core";
import type { WireImageAttachment } from "@liminal/protocol";

export function normalizeWireAttachments(
  attachments: WireImageAttachment[] | undefined
): { ok: true; attachments: Array<ImageAttachment & { dataUrl: string }> } | { ok: false; error: string } {
  const normalized: Array<ImageAttachment & { dataUrl: string }> = [];
  for (const item of attachments ?? []) {
    const dataUrl = String(item?.dataUrl ?? "").trim();
    const parsed = parseDataUrlImage(dataUrl);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    normalized.push({
      name: normalizeImageAttachmentName(String(item?.name ?? "image")),
      mimeType: parsed.mimeType,
      dataUrl,
      sizeBytes: parsed.sizeBytes,
      source: item?.source ?? "clipboard",
    });
  }
  const validation = validateImageAttachments(normalized, DEFAULT_IMAGE_ATTACHMENT_LIMITS);
  if (!validation.ok) return { ok: false, error: validation.error };
  return { ok: true, attachments: normalized };
}

export function buildOutboundUserMessage(
  message: string,
  attachments: Array<ImageAttachment & { dataUrl: string }>
): string {
  return buildMessageWithImageAttachments(message.trim(), attachments);
}
