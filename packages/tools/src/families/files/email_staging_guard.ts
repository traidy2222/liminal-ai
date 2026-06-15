/**
 * Block staging outbound email in workspace files when mail should live in drafts.
 */
const EMAIL_PATH_RE =
  /(?:^|[/\\])(?:[^/\\]*(?:email|e-mail|mail|draft|outreach|message)[^/\\]*|[^/\\]+\.(?:html?|eml))$/i;

function looksLikeEmailHtml(content: string): boolean {
  const c = content.trim();
  if (c.length < 40) return false;
  if (/<table\b/i.test(c)) return true;
  if (/\b(?:dear |hi |hello |subject:|unsubscribe|regards,|best,|sincerely,)\b/i.test(c)) {
    return /<(?:html|body|td|p)\b/i.test(c);
  }
  if (/<td\b[^>]*\bstyle\s*=/i.test(c) && /<html[\s>]/i.test(c)) return true;
  return false;
}

function looksLikeEmailPlain(content: string): boolean {
  const c = content.trim();
  if (c.length < 80) return false;
  const hasSubject = /^subject:\s*.+/im.test(c);
  const hasTo = /^to:\s*[\w.+-]+@/im.test(c);
  return hasSubject && hasTo;
}

/** Returns an error message when content looks like outbound mail staged as a file. */
export function rejectWorkspaceEmailStaging(path: string, content: string): string | null {
  const p = String(path ?? "").trim();
  if (!p || !EMAIL_PATH_RE.test(p.replace(/\\/g, "/"))) return null;
  if (!looksLikeEmailHtml(content) && !looksLikeEmailPlain(content)) return null;
  return (
    "Outbound email must not be staged as a workspace file. " +
    "Use gmail_create_draft / outlook_create_draft (or gmail_send_message for send-now) — mail lives in the mailbox as drafts/messages, not repo files. " +
    "To fix missing body_html, re-call the compose tool with a complete body_html + body; do not write_file."
  );
}
