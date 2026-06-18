import type { ChatFileAttachment } from "@liminal/core";
import { persistChatAttachmentsToWorkspace } from "@liminal/core";

export async function persistIncomingAttachments(
  attachments: Array<ChatFileAttachment & { dataUrl: string }>
): Promise<ChatFileAttachment[]> {
  return persistChatAttachmentsToWorkspace(attachments);
}
