/**
 * Outbound-mail placeholder detection (R-PRODUCT-TRUTH).
 * Canonical Liminal product facts live in the system prompt — not env or world context.
 */

/** Detect template placeholders / fake URLs in outbound copy. */
export function detectEmailPlaceholderViolations(text: string): string | null {
  const t = text.trim();
  if (!t) return null;

  const patterns: Array<[RegExp, string]> = [
    [/GITHUB_USERNAME/i, "GITHUB_USERNAME"],
    [/REPO_PLACEHOLDER/i, "REPO_PLACEHOLDER"],
    [/YOUR_(?:ORG|NAME|EMAIL|COMPANY|REPO)\b/i, "YOUR_* placeholder"],
    [/\byourorg\b/i, "yourorg"],
    [/\byour-org\b/i, "your-org"],
    [/example\.com/i, "example.com"],
    [/@email\.com\b/i, "@email.com"],
    [/\[insert\b/i, "[insert…]"],
    [/<(?:REPO|URL|NAME|EMAIL)[^>]*>/i, "<PLACEHOLDER>"],
    [/https?:\/\/github\.com\/[^/\s]+\/REPO/i, "github.com/…/REPO placeholder path"],
  ];

  for (const [re, label] of patterns) {
    if (re.test(t)) {
      return (
        `Outbound mail contains a template placeholder (${label}). ` +
        "Use Liminal product facts from the system prompt (repo/website), " +
        "list_connectors for the sending mailbox, and memory for the signer's name — do not send placeholders."
      );
    }
  }
  return null;
}
