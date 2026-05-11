import { defineTool } from "./helpers.js";
import pdfParse from "pdf-parse";
import { fetchWithRetry } from "./network_retry.js";

/** Per-request HTTP timeout for web_fetch and web_research page fetches. Clamp 3000–120000 ms. */
export function resolveWebFetchTimeoutMs(): number {
  const raw = process.env["AGENT_WEB_FETCH_TIMEOUT_MS"]?.trim();
  if (!raw) return 20_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 20_000;
  return Math.max(3000, Math.min(120_000, n));
}

export function unwrapRedirectUrl(url: string): string {
  const t = url.trim();
  try {
    const u = new URL(t, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
  } catch {
    /* keep */
  }
  return t;
}

/**
 * Remove author stylesheets/scripts before JSDOM parses HTML for Readability.
 * Readability uses DOM structure and metadata, not computed layout. JSDOM parses
 * inline style blocks with rrweb-cssom, which fails on nested/modern CSS
 * (nesting, :has(), CSS-in-JS) and emits noisy jsdomError. For real layout,
 * use Playwright browser_* tools.
 */
export function stripAuthorStylesAndScriptsForReadabilityDom(html: string): string {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<link\b[^>]*\brel\s*=\s*["']?\s*stylesheet\s*["']?[^>]*>/gi, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
}

export async function extractReadableHtml(html: string, pageUrl: string): Promise<string | null> {
  if (process.env["AGENT_WEB_READABILITY"] !== "1") return null;
  try {
    const { JSDOM, VirtualConsole } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");
    const prepared = stripAuthorStylesAndScriptsForReadabilityDom(html);
    const virtualConsole = new VirtualConsole();
    virtualConsole.on("jsdomError", () => {
      /* ignore CSS parse / resource noise for this throwaway parse */
    });
    const dom = new JSDOM(prepared, { url: pageUrl, virtualConsole });
    const article = new Readability(dom.window.document).parse();
    const text = article?.textContent?.replace(/\s+/g, " ").trim();
    return text && text.length > 80 ? text : null;
  } catch {
    return null;
  }
}

export async function runWebFetch(
  urlIn: string,
  maxChars: number
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const url = unwrapRedirectUrl(urlIn);
  try {
    const retried = await fetchWithRetry(
      url,
      {
        headers: { "User-Agent": "Mozilla/5.0 dreamthedream-agent/1.0" },
        redirect: "follow",
      },
      { timeoutMs: resolveWebFetchTimeoutMs() }
    );

    if (!retried.ok) {
      return { ok: false, error: `HTTP ${retried.status} ${retried.statusText}` };
    }

    const ct = (retried.headers.get("content-type") ?? "").toLowerCase();
    if (ct.includes("application/pdf") || url.toLowerCase().endsWith(".pdf")) {
      try {
        const buf = Buffer.from(await retried.arrayBuffer());
        const data = await pdfParse(buf);
        const text = (data.text ?? "").replace(/\s+/g, " ").trim();
        return { ok: true, output: text.slice(0, maxChars) };
      } catch (e) {
        return { ok: false, error: `PDF parse failed: ${String(e)}` };
      }
    }

    const text = await retried.text();
    const readable = await extractReadableHtml(text, url);
    const body =
      readable ??
      text
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    return { ok: true, output: body.slice(0, maxChars) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export const webFetchTool = defineTool({
  name: "web_fetch",
  description:
    "WHAT: Fetch URL content as plain text. Strips HTML; with AGENT_WEB_READABILITY=1 uses Readability on a DOM with author style/script tags removed (JSDOM cannot parse many modern stylesheets; this is article text extraction, not visual layout). PDFs → text when pdf-parse available. Timeout: AGENT_WEB_FETCH_TIMEOUT_MS (default 20s).\n" +
    "WHEN: You already have the exact URL — use web_search first to find it.\n" +
    "ARGS: url — full URL; max_chars — limit (default 8000).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 60_000,
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "URL to fetch" },
      max_chars: {
        type: "number",
        description: "Maximum characters to return (default: 8000)",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const url = args["url"] as string;
    const maxChars = (args["max_chars"] as number | undefined) ?? 8000;
    const hostname = (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 50); } })();
    emit?.(`\nfetching ${hostname}…\n`);
    const result = await runWebFetch(url, maxChars);
    if (result.ok) emit?.(`  ✓ ${result.output.length} chars\n`);
    return result;
  },
});
