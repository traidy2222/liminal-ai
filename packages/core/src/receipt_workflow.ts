/**
 * Guided receipt → Xero draft bill preset.
 *
 * Activated via UI "Process receipts", slash commands, or `workflowPreset` on send.
 * Not a new tool — a fixed recipe injected as a system turn + Xero family pre-seed.
 */
import {
  normalizeImageAttachmentName,
  type ImageAttachment,
} from "./image_attachments.js";
import { persistChatAttachmentsToWorkspace } from "./chat_attachments.js";

export const RECEIPT_WORKFLOW_PRESET = "receipt_to_xero" as const;
export type ReceiptWorkflowPreset = typeof RECEIPT_WORKFLOW_PRESET;

const RECEIPT_SLASH_RE = /^\/(?:receipt|receipts|process-receipts)(?:\s+(.*))?$/i;

const DEFAULT_USER_MESSAGE =
  "Process the attached receipt(s) into Xero as draft bill(s).";

/** Parse `/receipt`, `/receipts`, or `/process-receipts [optional note]`. */
export function parseReceiptSlashCommand(text: string): { note: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = RECEIPT_SLASH_RE.exec(trimmed);
  if (!match) return null;
  return { note: (match[1] ?? "").trim() };
}

export function isReceiptWorkflowPreset(
  value: string | undefined
): value is ReceiptWorkflowPreset {
  return value === RECEIPT_WORKFLOW_PRESET;
}

export function isReceiptWorkflowTurn(opts: {
  workflowPreset?: string;
  userMessage: string;
  imageAttachmentCount: number;
}): boolean {
  if (opts.imageAttachmentCount <= 0) return false;
  if (isReceiptWorkflowPreset(opts.workflowPreset)) return true;
  return parseReceiptSlashCommand(opts.userMessage) !== null;
}

/** User-visible message after stripping slash prefix (keeps optional note). */
export function resolveReceiptWorkflowUserMessage(note: string): string {
  const n = note.trim();
  return n || DEFAULT_USER_MESSAGE;
}

export function stripReceiptWorkflowCommandPrefix(userMessage: string): string {
  const parsed = parseReceiptSlashCommand(userMessage);
  if (!parsed) return userMessage.trim();
  return resolveReceiptWorkflowUserMessage(parsed.note);
}

/**
 * Write data-url attachments to `.agent_artifacts/uploads/` so `xero_upload_attachment`
 * can use `file_path`. Attachments that already have `filePath` are kept as-is.
 */
export async function persistImageAttachmentsToWorkspace(
  attachments: ImageAttachment[],
  workspaceRoot?: string
): Promise<ImageAttachment[]> {
  return persistChatAttachmentsToWorkspace(attachments, workspaceRoot);
}

function buildAttachmentPathsBlock(attachments: ImageAttachment[]): string {
  if (attachments.length === 0) {
    return "[RECEIPT ATTACHMENTS] None persisted — use content_base64 from the user attachment block if needed.";
  }
  const lines = ["[RECEIPT ATTACHMENTS] Use these paths for xero_upload_attachment (required):"];
  for (const item of attachments) {
    lines.push(
      `- file_name: ${item.name} | mime: ${item.mimeType} | file_path: ${item.filePath ?? "(missing — read from user attachment data_url)"}`
    );
  }
  return lines.join("\n");
}

export function buildReceiptWorkflowTurnInjection(opts: {
  userNote: string;
  attachments: ImageAttachment[];
}): string {
  const noteLine = opts.userNote.trim()
    ? `User note: ${opts.userNote.trim()}`
    : "User note: (none — infer expense category from the receipt only.)";

  return (
    "[RECEIPT → XERO WORKFLOW] Guided preset — follow this exact sequence. " +
    "Do not improvise alternate accounting paths or skip steps unless a step fails with a clear error. " +
    "This is not open-ended chat — execute the recipe, then summarize.\n\n" +
    `${noteLine}\n\n` +
    `${buildAttachmentPathsBlock(opts.attachments)}\n\n` +
    "**Prerequisites**\n" +
    "1. If Xero tools report not connected → `connect_provider({ provider: \"xero\", start_oauth: true })`, then retry.\n" +
    "2. Read the receipt from attached image(s): use native vision when available; otherwise `vision_analyze` on the attachment path/data_url before Xero writes.\n\n" +
    "**Fixed recipe (in order)**\n" +
    "1. **Supplier** — `xero_find_contact` by merchant/supplier name from the receipt. If no match → `xero_create_contact` (supplier) or `xero_upsert_contact`.\n" +
    "2. **Line items** — `xero_suggest_line_item` with `direction: \"purchase\"` for each line; map GST/tax from the receipt via `xero_list_tax_rates` when unsure.\n" +
    "3. **Duplicate guard** — `xero_duplicate_invoice_check` with `contact_id`, `reference`, `amount`, `type: \"ACCPAY\"`. If a likely duplicate exists, **stop** and summarize — do not create a bill.\n" +
    "4. **Bank path** — `xero_list_bank_accounts`. **If none / empty** → create a **DRAFT bill** (step 5). **If bank accounts exist** → still use **DRAFT bill** for this preset (do not post spend-money unless the user explicitly asked); mention available bank accounts in the summary for future reconciliation.\n" +
    "5. **Create bill** — `xero_create_bill` (defaults to **DRAFT** / ACCPAY) with `contact_id`, `line_items`, `date`, `reference` from the receipt.\n" +
    "6. **Attach source (required)** — `xero_upload_attachment` with `parent_type: \"Invoices\"`, `parent_id` = new bill InvoiceID, and `file_path` from [RECEIPT ATTACHMENTS] (or `content_base64` only if no path). Every bill must have the receipt image/PDF attached — bookkeepers and tax audit need the source file.\n" +
    "7. **Summarize** — Plain-language confirmation: supplier, date, reference, line totals, GST, account codes, bill ID/number, DRAFT status, attachment OK, duplicate-check result, and any private-vs-business flag from the user note.\n\n" +
    "**Constraints**\n" +
    "- Never AUTHORISE, pay, or email the bill — **DRAFT only** unless the user explicitly asked to post.\n" +
    "- Minimum tool calls on this path — no exploratory listing unless a step requires it.\n" +
    "- Honor user note for category hints (e.g. \"fuel receipt\" → motor vehicle / fuel expense accounts)."
  );
}
