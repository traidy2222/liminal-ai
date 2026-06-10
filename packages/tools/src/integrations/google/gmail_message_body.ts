/**
 * Decode Gmail API message parts (charset, HTML → plain, RFC 2047 headers).
 */

export interface GmailPartLike {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPartLike[];
  headers?: Array<{ name?: string; value?: string }>;
}

export function decodeBase64Url(data: string): Buffer {
  const padded = data.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, "base64");
}

export function charsetFromPart(part: GmailPartLike): string {
  const ct =
    part.headers?.find((h) => h.name?.toLowerCase() === "content-type")?.value ?? "";
  const m = /charset\s*=\s*["']?([a-zA-Z0-9._-]+)/i.exec(ct);
  const raw = (m?.[1] ?? "utf-8").trim().toLowerCase();
  if (raw === "utf8") return "utf-8";
  if (raw === "iso-8859-1" || raw === "latin1" || raw === "windows-1252") return raw;
  return raw;
}

export function decodePartBody(data: string, charset: string): string {
  const buf = decodeBase64Url(data);
  const enc = charset.trim().toLowerCase() || "utf-8";
  try {
    return new TextDecoder(enc, { fatal: false }).decode(buf);
  } catch {
    try {
      return new TextDecoder("utf-8", { fatal: false }).decode(buf);
    } catch {
      return buf.toString("latin1");
    }
  }
}

/** Decode =?UTF-8?B?...?= / =?UTF-8?Q?...?= encoded words in headers. */
export function decodeMimeHeaderValue(value: string): string {
  const trimmed = value.trim();
  if (!/=\?[^?]+\?[BQbq]\?/.test(trimmed)) return trimmed;

  const parts: string[] = [];
  const re = /=\?([^?]+)\?([BQbq])\?([^?]*)\?=/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    if (m.index > last) parts.push(trimmed.slice(last, m.index).replace(/\s+/g, " "));
    const charset = m[1]!;
    const mode = m[2]!.toUpperCase();
    const payload = m[3]!;
    if (mode === "B") {
      try {
        parts.push(new TextDecoder(charset, { fatal: false }).decode(Buffer.from(payload, "base64")));
      } catch {
        parts.push(payload);
      }
    } else {
      const qp = payload.replace(/_/g, " ");
      const bytes: number[] = [];
      for (let i = 0; i < qp.length; i++) {
        if (qp[i] === "=" && i + 2 < qp.length) {
          bytes.push(parseInt(qp.slice(i + 1, i + 3), 16));
          i += 2;
        } else {
          bytes.push(qp.charCodeAt(i));
        }
      }
      try {
        parts.push(new TextDecoder(charset, { fatal: false }).decode(new Uint8Array(bytes)));
      } catch {
        parts.push(String.fromCharCode(...bytes));
      }
    }
    last = re.lastIndex;
  }
  if (last < trimmed.length) parts.push(trimmed.slice(last));
  return parts.join("").replace(/\s+/g, " ").trim();
}

/** Count common UTF-8-as-Latin-1 / Shift-JIS mojibake markers. */
function countEmailMojibakeMarkers(text: string): number {
  const hits = text.match(/\uFFE2\uFF80|\u00e2\u0080|\u00e2\u20ac|Ã.|Â./g);
  return hits?.length ?? 0;
}

/**
 * Repair punctuation corrupted when UTF-8 bytes were misread (LLM output, JSON, or
 * client copy/paste). Fixes e.g. em dash showing as `￢ﾀﾔ` or `â€"`.
 */
export function repairEmailUnicode(text: string): string {
  if (!text || !/[^\x00-\x7f]/.test(text)) return text;

  let s = text;

  const fullwidth: Array<[RegExp, string]> = [
    [/\uFFE2\uFF80\uFF94/g, "\u2014"],
    [/\uFFE2\uFF80\uFF93/g, "\u2013"],
    [/\uFFE2\uFF80\uFF99/g, "\u2019"],
    [/\uFFE2\uFF80\uFF98/g, "\u2018"],
    [/\uFFE2\uFF80\uFF9C/g, "\u201C"],
    [/\uFFE2\uFF80\uFF9D/g, "\u201D"],
    [/\uFFE2\uFF80\uFF9A/g, "\u2026"],
  ];
  for (const [re, rep] of fullwidth) s = s.replace(re, rep);

  // UTF-8 bytes read as Latin-1 (E2 80 9x) or Windows-1252 (â + € + smart quote).
  const misreadUtf8: Array<[RegExp, string]> = [
    [/\u00e2\u0080\u0094/g, "\u2014"],
    [/\u00e2\u0080\u0093/g, "\u2013"],
    [/\u00e2\u0080\u0099/g, "\u2019"],
    [/\u00e2\u0080\u0098/g, "\u2018"],
    [/\u00e2\u0080\u009c/g, "\u201C"],
    [/\u00e2\u0080\u009d/g, "\u201D"],
    [/\u00e2\u0080\u00a6/g, "\u2026"],
    [/\u00e2\u20ac\u201d/g, "\u2014"],
    [/\u00e2\u20ac\u201c/g, "\u2013"],
    [/\u00e2\u20ac\u2122/g, "\u2019"],
    [/\u00e2\u20ac\u02dc/g, "\u2018"],
    [/\u00e2\u20ac\u0153/g, "\u201C"],
    [/\u00e2\u20ac\u009d/g, "\u201D"],
    [/\u00e2\u20ac\u00a6/g, "\u2026"],
  ];
  for (const [re, rep] of misreadUtf8) s = s.replace(re, rep);

  s = s.replace(/\u00C2\u00A0/g, "\u00A0");

  if (countEmailMojibakeMarkers(s) > 0) {
    try {
      const recovered = Buffer.from(s, "latin1").toString("utf8");
      if (
        recovered &&
        !recovered.includes("\uFFFD") &&
        countEmailMojibakeMarkers(recovered) < countEmailMojibakeMarkers(s)
      ) {
        s = recovered;
      }
    } catch {
      // keep s
    }
  }

  return s;
}

/** Replace em/en dashes in outbound mail with natural punctuation (less AI-telltale). */
export function humanizeOutboundEmailCopy(text: string): string {
  if (!text) return text;
  let s = text
    .replace(/&mdash;|&#0*8212;|&#x0*2014;/gi, ", ")
    .replace(/&ndash;|&#0*8211;|&#x0*2013;/gi, ", ")
    .replace(/\s*[\u2014\u2013]\s*/g, ", ")
    .replace(/([,.;])\s*,/g, "$1")
    .replace(/,\s*([.!?])/g, "$1")
  s = s.replace(/ {2,}/g, " ");
  return s;
}

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&mdash;/gi, "\u2014")
    .replace(/&ndash;/gi, "\u2013")
    .replace(/&lsquo;/gi, "\u2018")
    .replace(/&rsquo;/gi, "\u2019")
    .replace(/&ldquo;/gi, "\u201C")
    .replace(/&rdquo;/gi, "\u201D")
    .replace(/&hellip;/gi, "\u2026")
    .replace(/&#0*39;/gi, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCodePoint(code)
        : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) && code > 0 && code < 0x10ffff
        ? String.fromCodePoint(code)
        : _;
    });
}

export function htmlToPlainText(html: string): string {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, "");
  s = s.replace(/<style[\s\S]*?<\/style>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = decodeHtmlEntities(s);
  return normalizeEmailWhitespace(s);
}

export function normalizeEmailWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findPartByMime(root: GmailPartLike, mime: string): string {
  const want = mime.toLowerCase();
  const stack: GmailPartLike[] = [root];
  while (stack.length) {
    const part = stack.shift()!;
    const mt = (part.mimeType ?? "").toLowerCase();
    if (mt === want && part.body?.data) {
      return decodePartBody(part.body.data, charsetFromPart(part));
    }
    if (mt.startsWith("multipart/")) {
      for (const child of part.parts ?? []) stack.push(child);
    } else if (part.parts?.length) {
      for (const child of part.parts) stack.push(child);
    }
  }
  return "";
}

/** Prefer text/plain; fall back to HTML converted to plain. */
export function extractEmailBody(payload: GmailPartLike | undefined): string {
  if (!payload) return "";
  const plain = findPartByMime(payload, "text/plain");
  if (plain.trim()) return normalizeEmailWhitespace(plain);
  const html = findPartByMime(payload, "text/html");
  if (html.trim()) return htmlToPlainText(html);
  if (payload.body?.data) {
    const charset = charsetFromPart(payload);
    const raw = decodePartBody(payload.body.data, charset);
    const mt = (payload.mimeType ?? "").toLowerCase();
    if (mt.includes("html")) return htmlToPlainText(raw);
    return normalizeEmailWhitespace(raw);
  }
  return "";
}

/** Encode non-ASCII Subject/headers for RFC 822 drafts. */
export function encodeRfc822HeaderValue(value: string): string {
  if (!value) return value;
  if (/^[\x09\x20-\x7e]*$/.test(value)) return value;
  const b64 = Buffer.from(value, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

// ---------------------------------------------------------------------------
// MIME composition (rich HTML email: multipart/alternative + related + mixed).
//
// Gmail/Outlook ignore <style> blocks, flexbox, grid, and external CSS, so the
// model authors email-safe HTML (inline styles, table layout) freely — this
// builder only supplies the MIME envelope: a plain-text fallback alongside the
// HTML, inline images referenced as `cid:<id>`, and file attachments.
// ---------------------------------------------------------------------------

/** One binary part: an inline image (set `contentId`) or attachment (set `filename`). */
export interface MimeBlob {
  data: Buffer;
  mimeType: string;
  /** Display filename for attachments (encoded if non-ASCII). */
  filename?: string;
  /** Content-ID for inline images — reference in HTML as `cid:<contentId>`. */
  contentId?: string;
}

export interface BuildMimeOptions {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Rich HTML body. When present, a multipart/alternative is emitted. */
  html?: string;
  /** Plain-text body / fallback. Auto-derived from `html` when omitted. */
  text?: string;
  inlineImages?: MimeBlob[];
  attachments?: MimeBlob[];
  /** Message-ID this is a reply to (sets In-Reply-To + References for threading). */
  inReplyTo?: string;
}

function mimeBoundary(tag: string): string {
  let r = "";
  for (let i = 0; i < 24; i++) r += Math.floor(Math.random() * 36).toString(36);
  return `=_liminal_${tag}_${r}`;
}

/** RFC 2045: base64 wrapped at 76 chars with CRLF. */
function wrapBase64(b64: string): string {
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

/** A MIME node = its own Content-Type header block + body. */
function textNode(mime: string, content: string): string {
  const b64 = wrapBase64(Buffer.from(content, "utf8").toString("base64"));
  return (
    `Content-Type: ${mime}; charset="utf-8"\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n${b64}`
  );
}

function binaryNode(blob: MimeBlob, disposition: "inline" | "attachment"): string {
  const name = blob.filename ? encodeRfc822HeaderValue(blob.filename) : undefined;
  const head = [
    `Content-Type: ${blob.mimeType}${name ? `; name="${name}"` : ""}`,
    "Content-Transfer-Encoding: base64",
  ];
  if (blob.contentId) head.push(`Content-ID: <${blob.contentId}>`, `X-Attachment-Id: ${blob.contentId}`);
  head.push(`Content-Disposition: ${disposition}${name ? `; filename="${name}"` : ""}`);
  return `${head.join("\r\n")}\r\n\r\n${wrapBase64(blob.data.toString("base64"))}`;
}

function multipartNode(subtype: string, children: string[]): string {
  const b = mimeBoundary(subtype);
  const inner = children.map((c) => `--${b}\r\n${c}\r\n`).join("") + `--${b}--`;
  return `Content-Type: multipart/${subtype}; boundary="${b}"\r\n\r\n${inner}`;
}

/**
 * Build a base64url-encoded RFC 822 message for Gmail `drafts`/`messages` raw.
 * Picks the minimal nesting: text-only, alternative (text+html),
 * related (alternative + inline images), and/or mixed (… + attachments).
 */
export function buildMimeMessage(opts: BuildMimeOptions): string {
  const subject = humanizeOutboundEmailCopy(repairEmailUnicode(opts.subject));
  const headers = [`To: ${opts.to.join(", ")}`];
  if (opts.cc?.length) headers.push(`Cc: ${opts.cc.join(", ")}`);
  if (opts.bcc?.length) headers.push(`Bcc: ${opts.bcc.join(", ")}`);
  headers.push(`Subject: ${encodeRfc822HeaderValue(subject)}`, "MIME-Version: 1.0");
  if (opts.inReplyTo?.trim()) {
    headers.push(`In-Reply-To: ${opts.inReplyTo.trim()}`, `References: ${opts.inReplyTo.trim()}`);
  }

  const html = opts.html?.trim()
    ? humanizeOutboundEmailCopy(repairEmailUnicode(opts.html))
    : undefined;
  const text =
    opts.text != null && opts.text !== ""
      ? humanizeOutboundEmailCopy(repairEmailUnicode(opts.text))
      : html
        ? htmlToPlainText(html)
        : "";
  const inline = (opts.inlineImages ?? []).filter((b) => b.data.length > 0);
  const attach = (opts.attachments ?? []).filter((b) => b.data.length > 0);

  let node: string;
  if (html) {
    node = multipartNode("alternative", [
      textNode("text/plain", text || " "),
      textNode("text/html", html),
    ]);
    if (inline.length) {
      node = multipartNode("related", [node, ...inline.map((b) => binaryNode(b, "inline"))]);
    }
  } else {
    node = textNode("text/plain", text || " ");
  }
  if (attach.length) {
    node = multipartNode("mixed", [node, ...attach.map((b) => binaryNode(b, "attachment"))]);
  }

  // `node` already begins with its own Content-Type header, so it joins the
  // top-level header block directly (the entity's Content-Type lives there).
  const raw = `${headers.join("\r\n")}\r\n${node}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}
