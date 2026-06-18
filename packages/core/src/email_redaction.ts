/**
 * Deterministic redaction for email snippets/bodies shown to the user or model context.
 */

const REDACTED = "[REDACTED]";

/** User asked to summarize mail without leaking PII / secrets. */
export function isEmailPrivacyTurn(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return (
    /\b(redact|sanitize|sanitise|mask|censor|scrub|hide|remove|strip)\b[\s\S]{0,64}\b(sensitive|pii|personal|private|credential|password|secret|financial)/i.test(
      t
    ) ||
    /\b(sensitive|pii|personal|private)\b[\s\S]{0,64}\b(redact|sanitize|sanitise|mask|censor|scrub|hide)/i.test(
      t
    ) ||
    /\bwithout\s+(the\s+)?(sensitive|private|personal)\b/i.test(t) ||
    /\bno\s+sensitive\b/i.test(t)
  );
}

export const EMAIL_PRIVACY_TURN_INJECTION =
  "[EMAIL PRIVACY] The user wants mail summarized with sensitive details removed. " +
  "Call mail_search_inboxes with redact_sensitive:true (default). " +
  "In your reply: never paste raw account numbers, SSN, cards, passwords, OTPs, reset tokens, or API keys — use [REDACTED]. " +
  "Keep mailbox, subject gist, sender label, messageId, and threadId for routing.";

export interface EmailRedactionOptions {
  /** Partially mask email addresses (j***@domain.com). Default true. */
  maskEmails?: boolean;
  /** Mask phone numbers. Default true. */
  maskPhones?: boolean;
}

/**
 * Redact common sensitive patterns from email subject/snippet/body text.
 * Structural routing fields (messageId, threadId, mailbox=) should be redacted separately if needed.
 */
export function redactSensitiveEmailContent(
  text: string,
  options?: EmailRedactionOptions
): string {
  if (!text.trim()) return text;
  const maskEmails = options?.maskEmails !== false;
  const maskPhones = options?.maskPhones !== false;

  let out = text;

  // Credentials / secrets (align with R-CREDENTIALS-SAFETY)
  out = out.replace(
    /(api[_-]?key|token|secret|password|passwd|otp|pin|ssn|routing)\s*[:=]\s*["']?([^\s"'<>]{4,})/gi,
    `$1=${REDACTED}`
  );
  out = out.replace(/\b(sk-[a-zA-Z0-9_-]{16,})\b/g, REDACTED);
  out = out.replace(/\bghp_[a-zA-Z0-9]{20,}\b/g, REDACTED);
  out = out.replace(/\b(xox[baprs]-[a-zA-Z0-9-]{10,})\b/g, REDACTED);

  // SSN (US)
  out = out.replace(/\b\d{3}-\d{2}-\d{4}\b/g, REDACTED);

  // Credit / debit card (13–19 digits with optional separators)
  out = out.replace(/\b(?:\d[ -]*?){13,19}\b/g, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 13 || digits.length > 19) return m;
    return REDACTED;
  });

  // Standalone OTP / verification codes when labeled
  out = out.replace(
    /\b(verification|confirm(?:ation)?|security|auth|login|one[- ]time)\s*(?:code|pin|#)?\s*[:#]?\s*(\d{4,8})\b/gi,
    `$1 code ${REDACTED}`
  );

  // Long numeric account / reference numbers (9+ digits)
  out = out.replace(/\b\d{9,17}\b/g, REDACTED);

  // URL auth tokens (long query values)
  out = out.replace(
    /(https?:\/\/[^\s]+[?&](?:token|code|key|auth|session)=)([^&\s"']+)/gi,
    `$1${REDACTED}`
  );

  if (maskPhones) {
    out = out.replace(
      /(\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
      REDACTED
    );
  }

  if (maskEmails) {
    out = out.replace(
      /\b([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
      `$1***@$2`
    );
  }

  return out;
}

/** Redact a full mail_search_inboxes tool output block. */
export function redactMailSearchToolOutput(output: string): string {
  return output
    .split("\n")
    .map((line) => {
      if (/^\s*(mailbox|messageId|threadId)=/i.test(line)) return line;
      if (/^\s*from=/i.test(line)) {
        return line.replace(/<([^>]+)>/, (_m, email: string) => {
          const redacted = redactSensitiveEmailContent(email, { maskEmails: true });
          return `<${redacted}>`;
        });
      }
      if (/^\s*snippet=/i.test(line)) {
        const body = line.replace(/^\s*snippet=/, "");
        return `snippet=${redactSensitiveEmailContent(body)}`;
      }
      if (line.startsWith("- [") && line.includes("]")) {
        return line.replace(/\[([^\]]+)\]/, (_m, subject: string) => {
          return `[${redactSensitiveEmailContent(subject)}]`;
        });
      }
      return redactSensitiveEmailContent(line);
    })
    .join("\n");
}
