import type { ReactNode } from "react";

const HTML_EMBED_LANGS = new Set(["html", "htm", "xhtml"]);

/** HTML void elements — no closing tag. */
const HTML_VOID = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export function isHtmlEmbedLang(lang: string | undefined): boolean {
  return lang != null && HTML_EMBED_LANGS.has(lang.toLowerCase());
}

export function extractFencedCodeText(children: ReactNode): string {
  return String(children).replace(/\n$/, "");
}

export type StreamingHtmlFenceSplit = {
  /** Markdown for ReactMarkdown (text before an open ```html fence, or full text when closed). */
  outerMarkdown: string;
  /**
   * Body of the last ```html fence when it has no closing ``` yet.
   * `null` when no open fence or the fence is already closed (remark handles it).
   */
  htmlLive: string | null;
};

const HTML_FENCE_OPEN_RE = /```(?:html|htm|xhtml)\s*\r?\n/gi;

/**
 * While the model streams inside an unclosed ```html fence, remark does not emit a
 * `language-html` code node — the UI sees nothing until the closing fence arrives.
 * Peel off the live fence body so HtmlEmbedBlock can paint on every token.
 */
export function extractStreamingHtmlFence(text: string): StreamingHtmlFenceSplit {
  let lastOpenIdx = -1;
  let lastOpenLen = 0;
  let match: RegExpExecArray | null;
  HTML_FENCE_OPEN_RE.lastIndex = 0;
  while ((match = HTML_FENCE_OPEN_RE.exec(text)) !== null) {
    lastOpenIdx = match.index;
    lastOpenLen = match[0].length;
  }
  if (lastOpenIdx < 0) {
    return { outerMarkdown: text, htmlLive: null };
  }

  const afterOpen = text.slice(lastOpenIdx + lastOpenLen);
  const closeIdx = afterOpen.indexOf("```");
  if (closeIdx >= 0) {
    return { outerMarkdown: text, htmlLive: null };
  }

  return {
    outerMarkdown: text.slice(0, lastOpenIdx).trimEnd(),
    htmlLive: afterOpen,
  };
}

/**
 * Best-effort HTML for in-progress ```html fences: drop a truncated open tag at the
 * tail, then auto-close still-open elements so the browser can paint partial UI.
 */
export function balanceHtmlForStreamingPreview(html: string): string {
  let s = html.trim();
  if (!s) return "";

  const lastGt = s.lastIndexOf(">");
  const lastLt = s.lastIndexOf("<");
  if (lastLt > lastGt) {
    s = s.slice(0, lastLt).trimEnd();
  }
  if (!s) return "";

  const stack: string[] = [];
  const tagRe = /<\/?([a-zA-Z][\w:-]*)((?:\s+[^>]*)?)\s*(\/)?>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(s)) !== null) {
    const full = match[0];
    const name = match[1]!.toLowerCase();
    const selfClose = match[3] === "/" || full.endsWith("/>");
    if (selfClose || HTML_VOID.has(name)) continue;
    if (full.startsWith("</")) {
      const idx = stack.lastIndexOf(name);
      if (idx >= 0) stack.splice(idx);
    } else {
      stack.push(name);
    }
  }

  let out = s;
  for (let i = stack.length - 1; i >= 0; i--) {
    out += `</${stack[i]}>`;
  }
  return out;
}
