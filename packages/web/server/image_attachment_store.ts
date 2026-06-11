import type { ImageAttachment } from "@liminal/core";
import { persistImageAttachmentsToWorkspace } from "@liminal/core";

export async function persistIncomingAttachments(
  attachments: Array<ImageAttachment & { dataUrl: string }>
): Promise<ImageAttachment[]> {
  return persistImageAttachmentsToWorkspace(attachments);
}
