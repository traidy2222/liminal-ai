/**
 * Guardrails for Gmail compose/draft/send — enforce FORMATTED HTML for new outbound mail.
 */

const HTML_FIELD_KEYS = ["body_html", "html", "htmlBody", "html_body"] as const;
const PLAIN_FIELD_KEYS = ["body", "text", "plain", "message", "plain_body"] as const;
const REPLY_FIELD_KEYS = [
  "reply_to_message_id",
  "thread_id",
  "threadId",
  "in_reply_to",
  "inReplyTo",
  "message_id",
] as const;

export function pickEmailHtmlField(args: Record<string, unknown>): string {
  for (const key of HTML_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function pickEmailPlainField(args: Record<string, unknown>): string {
  for (const key of PLAIN_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function isGmailThreadReply(args: Record<string, unknown>): boolean {
  for (const key of REPLY_FIELD_KEYS) {
    const v = args[key];
    if (typeof v === "string" && v.trim()) return true;
  }
  return false;
}

/** One-liners and very short notes may stay plain. */
export function isSubstantivePlainBody(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (t.length <= 120 && !/\n/.test(t)) return false;
  return true;
}

/** Email-safe FORMATTED tier: tables and/or inline styles on block elements. */
export function looksLikeFormattedEmailHtml(html: string): boolean {
  const h = html.trim();
  if (h.length < 40) return false;
  if (/<table\b/i.test(h)) return true;
  if (/style\s*=\s*["'][^"']+["']/i.test(h) && /<(?:p|td|div|h[1-6]|span)\b/i.test(h)) return true;
  return false;
}

const TEXT_TAG_RE = /<(p|td|div|span|h[1-6]|li|a|strong|em|b)\b([^>]*)>/gi;
const STYLE_ATTR_RE = /style\s*=\s*["']([^"']*)["']/i;
const BGCOLOR_ATTR_RE = /bgcolor\s*=\s*["']?([^"'\s>]+)/i;

function parseHexColor(raw: string): { r: number; g: number; b: number } | null {
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{3,8}$/i.test(hex)) return null;
  const expanded =
    hex.length === 3
      ? hex
          .split("")
          .map((c) => c + c)
          .join("")
      : hex.slice(0, 6);
  return {
    r: parseInt(expanded.slice(0, 2), 16),
    g: parseInt(expanded.slice(2, 4), 16),
    b: parseInt(expanded.slice(4, 6), 16),
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function parseCssColorToken(token: string): number | null {
  const t = token.trim().toLowerCase();
  if (t === "white") return 1;
  if (t === "black") return 0;
  const hex = t.match(/#([0-9a-f]{3,8})/i)?.[1];
  if (hex) {
    const rgb = parseHexColor(hex);
    return rgb ? relativeLuminance(rgb.r, rgb.g, rgb.b) : null;
  }
  const rgb = t.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) {
    return relativeLuminance(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  }
  return null;
}

function extractStyleProp(style: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, "i");
  const m = re.exec(style);
  return m?.[1]?.trim() ?? null;
}

function bgLuminanceFromAttrs(attrs: string): number | null {
  const bgAttr = attrs.match(BGCOLOR_ATTR_RE)?.[1];
  if (bgAttr) {
    const lum = parseCssColorToken(bgAttr.startsWith("#") ? bgAttr : `#${bgAttr}`);
    if (lum != null) return lum;
  }
  const style = attrs.match(STYLE_ATTR_RE)?.[1] ?? "";
  for (const prop of ["background-color", "background"] as const) {
    const val = extractStyleProp(style, prop);
    if (!val) continue;
    const lum = parseCssColorToken(val.split(/\s+/)[0] ?? val);
    if (lum != null) return lum;
  }
  return null;
}

function fgLuminanceFromAttrs(attrs: string): number | null {
  const style = attrs.match(STYLE_ATTR_RE)?.[1] ?? "";
  const color = extractStyleProp(style, "color");
  if (!color) return null;
  return parseCssColorToken(color);
}

/**
 * Gmail/Outlook often strip outer table/div backgrounds. Light text then sits on
 * a forced-white canvas and becomes unreadable. Dark sections are fine when
 * bgcolor + color live on the same <td>.
 */
export function hasBrokenEmailContrast(html: string): boolean {
  let match: RegExpExecArray | null;
  TEXT_TAG_RE.lastIndex = 0;
  while ((match = TEXT_TAG_RE.exec(html)) !== null) {
    const attrs = match[2] ?? "";
    const fg = fgLuminanceFromAttrs(attrs);
    // Dark or unset text is fine on Gmail's default white canvas.
    if (fg == null || fg <= 0.62) continue;
    const bg = bgLuminanceFromAttrs(attrs);
    // Light text without a dark background on the same tag → unreadable after Gmail strips wrappers.
    if (bg == null || bg > 0.45) return true;
  }
  return false;
}

export const EMAIL_CONTRAST_ERROR =
  "body_html uses light-colored text without a dark background on the same cell. " +
  "Gmail strips outer wrapper backgrounds — co-locate bgcolor/background and color on each <td>. " +
  "Body copy: color:#222 or #333 on bgcolor:#ffffff. Dark bands: bgcolor:#1a1a2e AND color:#ffffff on the same <td>.";

/**
 * Returns a remediation error when new outbound mail is plain-only or HTML is too bare.
 * Thread replies and one-liners pass through.
 */
export function validateOutboundEmailStyle(args: Record<string, unknown>): string | null {
  if (isGmailThreadReply(args)) return null;

  const html = pickEmailHtmlField(args);
  const plain = pickEmailPlainField(args);

  if (html) {
    if (hasBrokenEmailContrast(html)) return EMAIL_CONTRAST_ERROR;
    if (looksLikeFormattedEmailHtml(html)) return null;
    if (html.length >= 80) {
      return (
        "body_html is present but looks unstyled (bare paragraphs without nested tables or inline styles). " +
        "Per R-EMAIL-STYLE, use FORMATTED email-safe HTML: ~600px centered table, accent header band, " +
        "headings, padded cells, muted footer — inline style attributes only. " +
        "Co-locate bgcolor and color on each <td> (Gmail strips outer dark backgrounds)."
      );
    }
    return null;
  }

  if (plain && isSubstantivePlainBody(plain)) {
    return (
      "New outbound mail must include FORMATTED body_html (nested tables, inline styles, accent color) " +
      "plus a plain body fallback. Plain-only is for thread replies and one-liners. " +
      "Use gmail_create_draft or gmail_send_message with body_html — not plain MCP create_draft."
    );
  }

  return null;
}
