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

export function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
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
