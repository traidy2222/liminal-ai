/**
 * Outbound recipient validation — guessed addresses cause Gmail "Address not found" bounces
 * even when the REST API returns a messageId.
 */

const REPLY_FIELD_KEYS = [
  "reply_to_message_id",
  "thread_id",
  "threadId",
  "in_reply_to",
  "inReplyTo",
  "message_id",
] as const;

const ROLE_LOCAL_PART =
  /^(?:partners?|business|hello|hi|contact|info|devrel|sales|support|team|press|media|hiring|careers|bd|bizdev|opensource|open-source|oss|api|help|admin|office|marketing|founders?|ceo|cto)$/i;

const EMAIL_FORMAT =
  /^[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

const USER_PROVIDED_SOURCE =
  /\buser\s+(?:provided|gave|specified|named)|(?:stated|said)\s+in\s+(?:chat|message)|from\s+the\s+user(?:'s)?\s+(?:message|request)/i;

export type OutboundMailDispatchMode = "draft" | "send";

export function isOutboundThreadReply(args: Record<string, unknown>): boolean {
  for (const key of REPLY_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((x) => String(x).trim()).filter(Boolean) : [];
}

/** All To/Cc/Bcc addresses from a compose tool args object. */
export function collectOutboundRecipientEmails(args: Record<string, unknown>): string[] {
  return [...strArray(args["to"]), ...strArray(args["cc"]), ...strArray(args["bcc"])];
}

export function isRoleMailboxAddress(email: string): boolean {
  const local = email.trim().toLowerCase().split("@")[0] ?? "";
  return ROLE_LOCAL_PART.test(local);
}

export function validateEmailAddressFormat(email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!e) return "empty recipient address";
  if (!EMAIL_FORMAT.test(e)) return `Invalid email format: ${email}`;
  if (e.endsWith("@example.com") || e.includes("@email.com")) {
    return `Placeholder or invalid domain: ${email}`;
  }
  return null;
}

function hasVerifiedRecipients(args: Record<string, unknown>): boolean {
  const v = args["recipients_verified"];
  if (v === true) return true;
  if (v === "true" || v === 1 || v === "1") return true;
  return false;
}

function recipientSource(args: Record<string, unknown>): string {
  return String(args["recipient_source"] ?? "").trim();
}

/** Registrable domain — handles com.au, co.uk, org.au, etc. */
function emailRegistrableDomain(email: string): string {
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (!domain) return "";
  const parts = domain.split(".").filter(Boolean);
  if (parts.length >= 3) {
    const sld = parts[parts.length - 2] ?? "";
    const tld = parts[parts.length - 1] ?? "";
    if (sld.length <= 3 && tld.length <= 3) {
      return parts.slice(-3).join(".");
    }
  }
  if (parts.length >= 2) return parts.slice(-2).join(".");
  return domain;
}

function hostMatchesEmailDomain(host: string, email: string): boolean {
  const reg = emailRegistrableDomain(email);
  const h = host.replace(/^www\./, "").toLowerCase();
  if (!reg || !h) return false;
  if (h === reg || h.endsWith(`.${reg}`)) return true;
  const org = reg.split(".")[0] ?? "";
  if (org.length >= 3 && h.includes(org)) return true;
  return false;
}

function sourceQuotesRecipientEmail(source: string, emails: string[]): boolean {
  const s = source.toLowerCase();
  return emails.some((e) => {
    const addr = e.trim().toLowerCase();
    return addr.length >= 5 && s.includes(addr);
  });
}

const OFFICIAL_PAGE_PATH =
  /\/(contact|about|partner|business|press|team|support|careers|connect|enquir(?:y|ies)|get-in-touch)\b/i;

/** Known business directories / maps listings — valid when web_fetch found the email on the page. */
const BUSINESS_DIRECTORY_HOST =
  /(?:^|\.)yellowpages\.com(?:\.au)?$|(?:^|\.)truelocal\.com\.au$|(?:^|\.)hotfrog\.com(?:\.au)?$|(?:^|\.)yelp\.com$|(?:^|\.)localsearch\.com\.au$|(?:^|\.)startlocal\.com\.au$|(?:^|\.)brownbook\.net$|(?:^|\.)facebook\.com$|(?:^|\.)linkedin\.com$|(?:^|\.)google\.[a-z.]+$|(?:^|\.)maps\.app\.goo\.gl$|(?:^|\.)goo\.gl$/i;

const DIRECTORY_LISTING_PATH =
  /\/(listing|listings|business|company|companies|profile|profiles|place|places|find|biz|org|pub|details|view|bp|contact-info|contact_us|contact-us)\b/i;

function isBusinessDirectoryListingUrl(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (!BUSINESS_DIRECTORY_HOST.test(host)) return false;
  const href = url.href;
  if (/google\.[a-z.]+$/.test(host) || host === "maps.app.goo.gl" || host === "goo.gl") {
    return /\/maps|\/place|[?&](?:q|query|cid|ludocid)=/i.test(href);
  }
  const path = url.pathname;
  if (!path || path === "/") return false;
  if (DIRECTORY_LISTING_PATH.test(path)) return true;
  // Specific listing slug: /business/acme-plumbing-melbourne
  return path.split("/").filter(Boolean).length >= 2;
}

/** Reject fabricated recipient_source when the model sets recipients_verified without evidence. */
export function isCredibleRecipientSource(source: string, emails: string[]): boolean {
  const s = source.trim();
  if (s.length < 8) return false;
  if (USER_PROVIDED_SOURCE.test(s)) return true;

  // Strongest signal: the exact To address appears in the cited source text.
  if (sourceQuotesRecipientEmail(s, emails)) return true;

  const urlMatch = s.match(/https?:\/\/[^\s<>"')]+/i);
  if (!urlMatch) return false;

  try {
    const url = new URL(urlMatch[0]!);
    const host = url.hostname.toLowerCase();
    if (host.includes("example.com") || host.includes("example.org")) return false;

    // Business directories / maps listings (email often only visible on the listing page).
    if (isBusinessDirectoryListingUrl(url)) return true;

    for (const email of emails) {
      if (hostMatchesEmailDomain(host, email)) return true;
    }

    if (OFFICIAL_PAGE_PATH.test(url.pathname)) return true;

    return false;
  } catch {
    return false;
  }
}

function coldMailVerificationError(mode: OutboundMailDispatchMode): string {
  if (mode === "send") {
    return (
      "Cold outbound mail must use gmail_create_draft then gmail_send_draft — not gmail_send_message. " +
      "gmail_send_message is for thread replies only. Guessed addresses bounce with Address not found."
    );
  }
  return (
    "Cold outbound mail requires recipients_verified: true after web_search + web_fetch found each address " +
    "(official site, business directory listing, Google Maps, LinkedIn company page, or user named it in chat). " +
    "Never invent YouTuber/partners@/business@ addresses. Prefer gmail_create_draft for human review before send."
  );
}

/**
 * Block guessed outreach addresses. Cold mail requires research-backed recipients.
 */
export function validateOutboundEmailRecipients(
  args: Record<string, unknown>,
  mode: OutboundMailDispatchMode
): string | null {
  const emails = collectOutboundRecipientEmails(args);
  if (emails.length === 0) return "to must include at least one address";

  for (const e of emails) {
    const fmt = validateEmailAddressFormat(e);
    if (fmt) return fmt;
  }

  if (isOutboundThreadReply(args)) return null;

  // No cold blast sends — draft → review → send_draft only.
  if (mode === "send") {
    return coldMailVerificationError("send");
  }

  const verified = hasVerifiedRecipients(args);
  const source = recipientSource(args);

  if (!verified) {
    return coldMailVerificationError("draft");
  }

  if (!isCredibleRecipientSource(source, emails)) {
    const sample = emails[0] ?? "name@company.com";
    return (
      "recipient_source is not credible — cite where web_fetch found the address: official site URL, " +
      "business directory listing (Yellow Pages, True Local, Google Maps), or quote the exact email. " +
      `Example: "https://www.truelocal.com.au/business/acme — ${sample}". User-provided: say so explicitly.`
    );
  }

  return null;
}
