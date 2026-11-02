/** Browser-safe receipt command parser. */
const RECEIPT_SLASH_RE = /^\/(?:receipt|receipts|process-receipts)(?:\s+(.*))?$/i;

/** Parse `/receipt`, `/receipts`, or `/process-receipts [optional note]`. */
export function parseReceiptSlashCommand(text: string): { note: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const match = RECEIPT_SLASH_RE.exec(trimmed);
  if (!match) return null;
  return { note: (match[1] ?? "").trim() };
}
