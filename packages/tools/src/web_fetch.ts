import { defineTool } from "./helpers.js";
import pdfParse from "pdf-parse";
import { fetchWithRetry } from "./network_retry.js";

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

export async function extractReadableHtml(html: string, pageUrl: string): Promise<string | null> {
  if (process.env["AGENT_WEB_READABILITY"] !== "1") return null;
  try {
    const { JSDOM } = await import("jsdom");
    const { Readability } = await import("@mozilla/readability");
    const dom = new JSDOM(html, { url: pageUrl });
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
      { timeoutMs: 20_000 }
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
    "WHAT: Fetch URL content as plain text. Strips HTML; with AGENT_WEB_READABILITY=1 uses Readability. PDFs → text when pdf-parse available.\n" +
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
