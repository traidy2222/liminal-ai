/**
 * Shared assistant-message markdown rendering for the web UI.
 *
 * - Unfenced HTML in markdown is rendered via rehype-raw (caller passes rehypePlugins).
 * - Fenced ```html blocks render as live HTML (including while streaming).
 */
import type { CSSProperties, ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import { unified } from "unified";
import rehypeParse from "rehype-parse";
import rehypeStringify from "rehype-stringify";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { LIM } from "./persona/personaVars.js";
import {
  balanceHtmlForStreamingPreview,
  extractFencedCodeText,
  extractStreamingHtmlFence,
  isHtmlEmbedLang,
} from "./liminalMarkdownUtils.js";

export {
  balanceHtmlForStreamingPreview,
  extractFencedCodeText,
  extractStreamingHtmlFence,
  isHtmlEmbedLang,
} from "./liminalMarkdownUtils.js";

export const LIMINAL_MARKDOWN_REMARK_PLUGINS = [remarkGfm];
export const LIMINAL_MARKDOWN_REHYPE_PLUGINS = [rehypeRaw, rehypeSanitize];

const embedSanitizer = unified()
  .use(rehypeParse, { fragment: true })
  .use(rehypeSanitize)
  .use(rehypeStringify);

function sanitizeEmbedHtml(html: string): string {
  try {
    return String(embedSanitizer.processSync(html));
  } catch {
    return "";
  }
}

/**
 * Assistant bubble: during streaming, open ```html fences are rendered outside
 * ReactMarkdown so partial HTML paints live (remark waits for a closing fence).
 */
export function AssistantMessageContent({
  text,
  streaming,
  components,
}: {
  text: string;
  streaming: boolean;
  components?: Components;
}) {
  const split = streaming
    ? extractStreamingHtmlFence(text)
    : { outerMarkdown: text, htmlLive: null as string | null };

  return (
    <>
      {split.outerMarkdown.length > 0 ? (
        <ReactMarkdown
          remarkPlugins={LIMINAL_MARKDOWN_REMARK_PLUGINS}
          rehypePlugins={LIMINAL_MARKDOWN_REHYPE_PLUGINS}
          components={components}
        >
          {split.outerMarkdown}
        </ReactMarkdown>
      ) : null}
      {split.htmlLive !== null ? <HtmlEmbedBlock html={split.htmlLive} streaming /> : null}
    </>
  );
}

/**
 * Live HTML embed. When `streaming`, auto-closes open tags so the browser can paint
 * partial markup on each token — same visual shell as the finished embed (no badge).
 */
export function HtmlEmbedBlock({ html, streaming = false }: { html: string; streaming?: boolean }) {
  const rawHtml = streaming ? balanceHtmlForStreamingPreview(html) : html;
  const displayHtml = sanitizeEmbedHtml(rawHtml);
  if (!displayHtml.trim()) return null;

  return (
    <div
      className="lim-html-embed"
      style={{ margin: "10px 0", maxWidth: "100%", overflowX: "auto", borderRadius: 6 }}
    >
      <div className="lim-md" dangerouslySetInnerHTML={{ __html: displayHtml }} />
    </div>
  );
}

export type FencedCodeBlockOptions = {
  /** When true, ```html fences re-render live on each token (balanced partial DOM). */
  streaming?: boolean;
  codeBg?: string;
  inlineCodeStyle?: CSSProperties;
};

/**
 * Renders fenced code blocks: `html`/`htm`/`xhtml` → live HTML; other langs → Prism.
 */
export function renderFencedCodeBlock(
  className: string | undefined,
  children: ReactNode,
  opts: FencedCodeBlockOptions = {}
): React.ReactElement {
  const lang = /language-(\w+)/.exec(className ?? "")?.[1];
  const raw = extractFencedCodeText(children);
  const codeBg = opts.codeBg ?? LIM.codeBg;

  if (isHtmlEmbedLang(lang)) {
    return <HtmlEmbedBlock html={raw} streaming={opts.streaming} />;
  }

  if (lang) {
    return (
      <div
        style={{
          borderRadius: 6,
          overflow: "hidden",
          margin: "10px 0",
          border: "1px solid rgba(var(--lim-accent-rgb),0.1)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "4px 12px",
            background: LIM.surface,
            borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.08)",
          }}
        >
          <span
            style={{
              color: "rgba(var(--lim-accent-rgb),0.4)",
              fontSize: 10,
              fontFamily: LIM.fontMono,
              letterSpacing: "0.06em",
            }}
          >
            {lang}
          </span>
        </div>
        <SyntaxHighlighter
          language={lang}
          style={vscDarkPlus}
          customStyle={{
            margin: 0,
            borderRadius: 0,
            fontSize: 13,
            background: codeBg,
            userSelect: "text",
            WebkitUserSelect: "text",
          }}
          codeTagProps={{
            style: {
              userSelect: "text",
              WebkitUserSelect: "text",
            },
          }}
          showLineNumbers={raw.split("\n").length > 6}
          lineNumberStyle={{ color: LIM.textDim, minWidth: "2.5em", opacity: 0.45, userSelect: "none" }}
          wrapLongLines
        >
          {raw}
        </SyntaxHighlighter>
      </div>
    );
  }

  return (
    <code
      style={
        opts.inlineCodeStyle ?? {
          background: LIM.surface1,
          border: "1px solid rgba(var(--lim-accent-rgb),0.12)",
          borderRadius: 3,
          padding: "1px 5px",
          color: LIM.success,
          fontFamily: LIM.fontMono,
          fontSize: "0.9em",
        }
      }
    >
      {children}
    </code>
  );
}
