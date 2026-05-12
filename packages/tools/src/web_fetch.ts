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
  maxChars: number,
  opts?: { includeAssets?: boolean; assetsMax?: number }
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const url = unwrapRedirectUrl(urlIn);
  const includeAssets = opts?.includeAssets ?? false;
  const assetsMax = Math.max(1, Math.min(100, opts?.assetsMax ?? 30));
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
    if (ct.startsWith("image/")) {
      const size = retried.headers.get("content-length") ?? "unknown";
      return {
        ok: true,
        output:
          `Direct image URL: ${url}\n` +
          `content-type: ${ct || "unknown"}\n` +
          `content-length: ${size}\n` +
          `Hint: pass this URL (or a downloaded local file) to vision_analyze for image understanding.`,
      };
    }
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

    if (!includeAssets) {
      return { ok: true, output: body.slice(0, maxChars) };
    }

    const assets = extractPageAssets(text, url, assetsMax);
    const sections: string[] = [body.slice(0, maxChars)];
    if (assets.links.length > 0) {
      sections.push(
        "",
        "## Discovered links",
        ...assets.links.map((u, i) => `${i + 1}. ${u}`)
      );
    }
    if (assets.images.length > 0) {
      sections.push(
        "",
        "## Discovered image links",
        ...assets.images.map((u, i) => `${i + 1}. ${u}`),
        "",
        "Hint: use vision_analyze on the most relevant image URL or local image file."
      );
    }

    return { ok: true, output: sections.join("\n").slice(0, Math.max(maxChars, 12_000)) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function toAbsoluteMaybe(raw: string, pageUrl: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (t.startsWith("javascript:") || t.startsWith("mailto:") || t.startsWith("tel:")) return null;
  try {
    return new URL(t, pageUrl).toString();
  } catch {
    return null;
  }
}

function collectAttrUrls(html: string, attr: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const abs = toAbsoluteMaybe(m[1] ?? "", pageUrl);
    if (abs) out.push(abs);
  }
  return out;
}

function collectSrcsetUrls(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  const re = /srcset\s*=\s*["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const entries = (m[1] ?? "").split(",");
    for (const e of entries) {
      const first = e.trim().split(/\s+/)[0] ?? "";
      const abs = toAbsoluteMaybe(first, pageUrl);
      if (abs) out.push(abs);
    }
  }
  return out;
}

function dedupeClamp(items: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
    if (out.length >= max) break;
  }
  return out;
}

function looksLikeImageUrl(url: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|bmp|svg|avif)(\?|#|$)/i.test(url);
}

function extractPageAssets(
  html: string,
  pageUrl: string,
  maxItems: number
): { links: string[]; images: string[] } {
  const hrefs = collectAttrUrls(html, "href", pageUrl);
  const srcs = collectAttrUrls(html, "src", pageUrl);
  const dataSrcs = collectAttrUrls(html, "data-src", pageUrl);
  const srcset = collectSrcsetUrls(html, pageUrl);
  const all = [...hrefs, ...srcs, ...dataSrcs, ...srcset];
  const images = dedupeClamp(
    all.filter((u) => looksLikeImageUrl(u)),
    maxItems
  );
  const links = dedupeClamp(
    hrefs.filter((u) => u.startsWith("http://") || u.startsWith("https://")),
    maxItems
  );
  return { links, images };
}

export const webFetchTool = defineTool({
  name: "web_fetch",
  description:
    "WHAT: Fetch URL content as plain text. Optional discovery of useful links and image URLs from the page for follow-up browsing/vision. Strips HTML; with AGENT_WEB_READABILITY=1 uses Readability on a DOM with author style/script tags removed (JSDOM cannot parse many modern stylesheets; this is article text extraction, not visual layout). PDFs → text when pdf-parse available. Direct image URLs return metadata + vision hint. Timeout: AGENT_WEB_FETCH_TIMEOUT_MS (default 20s).\n" +
    "WHEN: You already have the exact URL — use web_search first to find it.\n" +
    "ARGS: url — full URL; max_chars — body char limit (default 8000); include_assets — append discovered links/image links (default true); assets_max — cap per asset list (default 30, max 100).",
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
      include_assets: {
        type: "boolean",
        description: "Append discovered links and image URLs from page HTML (default: true).",
      },
      assets_max: {
        type: "number",
        description: "Maximum discovered links/images per section (default: 30, max: 100).",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const url = args["url"] as string;
    const maxChars = (args["max_chars"] as number | undefined) ?? 8000;
    const includeAssets = (args["include_assets"] as boolean | undefined) ?? true;
    const assetsMax = (args["assets_max"] as number | undefined) ?? 30;
    const hostname = (() => { try { return new URL(url).hostname; } catch { return url.slice(0, 50); } })();
    emit?.(`\nfetching ${hostname}…\n`);
    const result = await runWebFetch(url, maxChars, { includeAssets, assetsMax });
    if (result.ok) emit?.(`  ✓ ${result.output.length} chars\n`);
    return result;
  },
});
