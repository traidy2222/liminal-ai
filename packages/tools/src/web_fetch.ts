import { defineTool } from "./helpers.js";
import pdfParse from "pdf-parse";
import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";
import { fetchWithRetry } from "./network_retry.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import {
  buildFallbackFetchUrl,
  buildWebFetchInit,
  is403RetryEnabled,
  parseCharsetFromContentType,
  peekLooksLikeBotWall,
  resolveTextDecoderLabel,
} from "./web_fetch_http.js";

/** Per-request HTTP timeout for web_fetch page fetches. Clamp 3000–120000 ms. */
export function resolveWebFetchTimeoutMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_TIMEOUT_MS")?.trim();
  if (!raw) return 20_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 20_000;
  return Math.max(3000, Math.min(120_000, n));
}

/** Retries after 429/5xx or transient network errors (each retry is a new attempt). Default 2 to cap worst-case wall time. */
export function resolveWebFetchRetries(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_RETRIES")?.trim();
  if (!raw) return 2;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 2;
  return Math.max(0, Math.min(8, n));
}

/** Max backoff between web_fetch retries (ms). Default 6s so 6 retries do not add minutes of sleep alone. */
export function resolveWebFetchMaxRetryDelayMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_RETRY_MAX_DELAY_MS")?.trim();
  if (!raw) return 6000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 6000;
  return Math.max(500, Math.min(30_000, n));
}

/**
 * Hard wall clock for one web_fetch tool call (fetch + retries + HTML parse + optional PDF).
 * Prevents sessions from appearing "stuck" for minutes when several fetches run in parallel.
 */
export function resolveWebFetchTotalWallMs(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_TOTAL_WALL_MS")?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n)) return 55_000;
    return Math.max(8000, Math.min(180_000, n));
  }
  return 55_000;
}

/** Max HTML characters passed to JSDOM + Readability (main-thread parse can freeze the process for minutes on large pages). */
export function resolveWebFetchReadabilityMaxInputChars(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS")?.trim();
  if (!raw) return 72_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 72_000;
  return Math.max(16_000, Math.min(250_000, n));
}

/** Truncate HTML before regex strip / Readability to avoid multi‑minute JSDOM stalls on huge pages. */
export function resolveWebFetchMaxPreprocessChars(): number {
  const raw = effectiveHarnessEnvRaw("AGENT_WEB_FETCH_MAX_PREPROCESS_CHARS")?.trim();
  if (!raw) return 400_000;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 400_000;
  return Math.max(50_000, Math.min(2_000_000, n));
}

const PDF_MAX_BYTES = 6_000_000;
const RESPONSE_BODY_WARN_BYTES = 25_000_000;
/** Stop downloading HTML/text bodies after this many bytes (slow servers can otherwise stall `.text()` forever). */
const MAX_DOWNLOAD_TEXT_BYTES = 2_500_000;

/** First bytes look like gzip — undecoded compression often means the client offered encodings the runtime did not decode. */
export function sniffCompressedPayloadHead(u8: Uint8Array): string | null {
  if (u8.length < 2) return null;
  if (u8[0] === 0x1f && u8[1] === 0x8b) {
    return (
      "web_fetch: body begins with gzip magic bytes but was read as raw bytes (compression not decoded). " +
      "Try browser_open / browser_act, or ensure Accept-Encoding does not negotiate encodings your Node build cannot decompress."
    );
  }
  if (u8[0] === 0x78 && (u8[1] === 0x01 || u8[1] === 0x9c || u8[1] === 0xda)) {
    return (
      "web_fetch: body begins with zlib/deflate raw stream, not decoded HTML. " +
      "Use browser_open for JS-rendered or oddly-encoded pages."
    );
  }
  return null;
}

/** Heuristic: decoded “HTML” that is mostly replacement/control characters is usually binary or wrong transport. */
export function looksLikeDecodedBinaryGarbage(text: string): boolean {
  const sample = text.slice(0, 12_000);
  if (sample.length < 400) return false;
  let bad = 0;
  for (let i = 0; i < sample.length; i++) {
    const c = sample.charCodeAt(i);
    if (c === 0xfffd) bad += 3;
    else if (c > 0 && c < 9) bad += 2;
    else if (c > 13 && c < 32) bad += 1;
  }
  return bad / sample.length > 0.12;
}

/** Longer compound suffixes first so `.tar.gz` wins over `.gz`. */
const REFUSED_URL_SUFFIXES: readonly string[] = [
  ".tar.gz",
  ".tar.bz2",
  ".tar.xz",
  ".tar.zst",
  ".tgz",
  ".tbz2",
  ".txz",
  ".crdownload",
  ".dmg",
  ".pkg",
  ".msi",
  ".msix",
  ".msp",
  ".exe",
  ".dll",
  ".com",
  ".bat",
  ".cmd",
  ".ps1",
  ".scr",
  ".app",
  ".deb",
  ".rpm",
  ".apk",
  ".ipa",
  ".jar",
  ".war",
  ".ear",
  ".zip",
  ".7z",
  ".rar",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".zst",
  ".lz4",
  ".lzma",
  ".cab",
  ".iso",
  ".img",
  ".vmdk",
  ".bin",
  ".elf",
  ".run",
  ".so",
  ".dylib",
  ".wasm",
];

/** Block fetch by URL path — archives, installers, and obvious binaries (not HTML/PDF pages). */
export function refuseBinaryWebFetchUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const seg = path.split("/").filter(Boolean).pop() ?? "";
    const name = seg.split("?")[0]!.split("#")[0]!;
    for (const suf of REFUSED_URL_SUFFIXES) {
      if (name.endsWith(suf)) {
        return (
          `web_fetch refuses URLs whose path ends with “${suf}” (archive, installer, or binary). ` +
          "Use http_request to save to disk, run_shell with a verified path, or open locally — not in-page text extraction."
        );
      }
    }
  } catch {
    return null;
  }
  return null;
}

const REFUSED_CONTENT_TYPE_MAIN: readonly RegExp[] = [
  /^application\/(gzip|x-gzip)$/,
  /^application\/(zip|x-zip-compressed)$/,
  /^application\/(x-rar-compressed|x-7z-compressed|x-tar)$/,
  /^application\/(x-msdownload|x-msdos-program|x-dosexec|x-msi)$/,
  /^application\/(x-executable|x-sharedlib|java-archive|vnd\.microsoft\.portable-executable)$/,
  /^application\/(x-apple-diskimage|vnd\.android\.package-archive)$/,
  /^application\/octet-stream$/,
  /^application\/wasm$/,
];

/** Block by declared Content-Type when it is clearly not page text (archives, PE, wasm, generic binary). */
export function refuseBinaryWebFetchContentType(ctRaw: string): string | null {
  const ct = ctRaw.trim().toLowerCase();
  const main = ct.split(";")[0]!.trim();
  if (!main) return null;
  for (const re of REFUSED_CONTENT_TYPE_MAIN) {
    if (re.test(main)) {
      return (
        `web_fetch refuses content-type “${ctRaw.trim()}” (archive, executable, or generic binary). ` +
        "Use browser_open, http_request, or a human download path if you need the file."
      );
    }
  }
  return null;
}

/**
 * Read response body with a byte cap and abort checks between chunks.
 * Uses encoding from Content-Type when caller passes `encodingLabel` (see charset resolution in runWebFetchInner).
 */
function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

/** Per-chunk idle cap so trickle responses cannot stall body reads past the wall budget. */
function resolveWebFetchBodyChunkIdleMs(perAttemptTimeoutMs: number): number {
  return Math.max(4000, Math.min(20_000, Math.round(perAttemptTimeoutMs * 0.75)));
}

async function readStreamChunkWithIdleTimeout<T>(
  read: () => Promise<T>,
  idleMs: number,
  signal: AbortSignal
): Promise<T> {
  throwIfAborted(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new DOMException(`body read idle > ${idleMs}ms`, "AbortError")),
      idleMs
    );
  });
  const onAbort = () => {
    if (timer) clearTimeout(timer);
  };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    return await Promise.race([read(), idle]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}

async function readResponseTextWithCap(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
  encodingLabel = "utf-8",
  chunkIdleMs = 15_000
): Promise<string> {
  const label = resolveTextDecoderLabel(encodingLabel);
  if (!res.body) {
    throwIfAborted(signal);
    const buf = await res.arrayBuffer();
    const raw = new Uint8Array(buf);
    const sniff = sniffCompressedPayloadHead(raw);
    if (sniff) throw new Error(sniff);
    return new TextDecoder(label, { fatal: false }).decode(buf);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder(label, { fatal: false });
  let received = 0;
  let out = "";
  let sniffHead = new Uint8Array(0);
  let sniffDone = false;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readStreamChunkWithIdleTimeout(
        () => reader.read(),
        chunkIdleMs,
        signal
      );
      if (done) break;
      if (value && value.byteLength > 0) {
        if (!sniffDone) {
          const next = new Uint8Array(sniffHead.length + value.length);
          next.set(sniffHead);
          next.set(value, sniffHead.length);
          sniffHead = next.length > 16 ? next.subarray(0, 16) : next;
          if (sniffHead.length >= 2) {
            const sniff = sniffCompressedPayloadHead(sniffHead);
            if (sniff) {
              await reader.cancel().catch(() => undefined);
              throw new Error(sniff);
            }
            sniffDone = true;
          }
        }
        received += value.byteLength;
        out += dec.decode(value, { stream: true });
        if (received >= maxBytes) {
          await reader.cancel().catch(() => undefined);
          out += dec.decode();
          out += `\n[download truncated at ${maxBytes} bytes — page may be incomplete]`;
          return out;
        }
      }
    }
    out += dec.decode();
    return out;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
}

async function readResponseArrayBufferWithCap(
  res: Response,
  maxBytes: number,
  signal: AbortSignal,
  chunkIdleMs = 15_000
): Promise<ArrayBuffer> {
  if (!res.body) {
    throwIfAborted(signal);
    const buf = await res.arrayBuffer();
    return buf.byteLength > maxBytes ? buf.slice(0, maxBytes) : buf;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await readStreamChunkWithIdleTimeout(
        () => reader.read(),
        chunkIdleMs,
        signal
      );
      if (done) break;
      if (value && value.byteLength > 0) {
        received += value.byteLength;
        if (received > maxBytes) {
          const take = value.byteLength - (received - maxBytes);
          if (take > 0) chunks.push(value.subarray(0, take));
          await reader.cancel().catch(() => undefined);
          break;
        }
        chunks.push(value);
      }
    }
    const total = chunks.reduce((s, c) => s + c.byteLength, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const c of chunks) {
      out.set(c, o);
      o += c.byteLength;
    }
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* ignore */
    }
  }
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

const READABILITY_WORKER_URL = new URL("./web_fetch_readability_worker.js", import.meta.url);

function runReadabilityInWorker(
  preparedHtml: string,
  pageUrl: string,
  parseMs: number,
  signal?: AbortSignal
): Promise<string | null> {
  if (signal?.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (text: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      void worker.terminate();
      resolve(text);
    };
    const onAbort = () => finish(null);
    signal?.addEventListener("abort", onAbort, { once: true });
    const workerPath = fileURLToPath(READABILITY_WORKER_URL);
    const worker = new Worker(workerPath, {
      workerData: { html: preparedHtml, pageUrl },
    });
    const timer = setTimeout(() => finish(null), parseMs);
    worker.on("message", (msg: { ok?: boolean; text?: string }) => {
      const text = typeof msg.text === "string" ? msg.text.trim() : "";
      finish(text.length > 80 ? text : null);
    });
    worker.on("error", () => finish(null));
    worker.on("exit", (code) => {
      if (!settled && code !== 0) finish(null);
    });
  });
}

export async function extractReadableHtml(
  html: string,
  pageUrl: string,
  opts?: { signal?: AbortSignal }
): Promise<string | null> {
  if (effectiveHarnessEnvRaw("AGENT_WEB_READABILITY") !== "1") return null;
  const signal = opts?.signal;
  if (signal?.aborted) return null;
  const maxIn = resolveWebFetchMaxPreprocessChars();
  const readCap = resolveWebFetchReadabilityMaxInputChars();
  const clipped = html.length > maxIn ? html.slice(0, maxIn) : html;
  const forReadability = clipped.length > readCap ? clipped.slice(0, readCap) : clipped;
  const parseMs = Math.max(
    3000,
    Math.min(25_000, Number(effectiveHarnessEnvRaw("AGENT_WEB_FETCH_READABILITY_MS") ?? "") || 12_000)
  );
  try {
    const prepared = stripAuthorStylesAndScriptsForReadabilityDom(forReadability);
    return await runReadabilityInWorker(prepared, pageUrl, parseMs, signal);
  } catch {
    return null;
  }
}

function parseContentLength(h: Headers): number | null {
  const cl = h.get("content-length");
  if (!cl) return null;
  const n = parseInt(cl, 10);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch with browser-like headers; on 403/401 may retry with alt profile and/or optional fallback reader URL.
 * Original Response may have a partially consumed body after peek — callers must treat !ok as terminal for that object.
 */
async function obtainWebFetchResponse(
  pageUrl: string,
  externalSignal: AbortSignal,
  timeoutMs: number,
  retries: number,
  maxBackoff: number
): Promise<Response> {
  const chunkIdleMs = resolveWebFetchBodyChunkIdleMs(timeoutMs);
  const cfg = {
    timeoutMs,
    maxRetries: retries,
    maxDelayMs: maxBackoff,
    externalSignal,
    tieTimeoutToFullDownload: true as const,
  };
  const primary = await fetchWithRetry(pageUrl, buildWebFetchInit("primary"), cfg);
  if (primary.ok) return primary;
  if (primary.status !== 403 && primary.status !== 401) return primary;

  let peekText = "";
  try {
    const ab = await readResponseArrayBufferWithCap(primary, 16_384, externalSignal, chunkIdleMs);
    peekText = new TextDecoder("utf-8", { fatal: false }).decode(ab);
  } catch {
    /* empty or aborted */
  }

  if (is403RetryEnabled() && peekLooksLikeBotWall(peekText)) {
    throwIfAborted(externalSignal);
    try {
      const alt = await fetchWithRetry(pageUrl, buildWebFetchInit("alt"), cfg);
      if (alt.ok) return alt;
    } catch {
      /* network */
    }
    throwIfAborted(externalSignal);
    try {
      const chromeX = await fetchWithRetry(pageUrl, buildWebFetchInit("chrome_cross_site"), cfg);
      if (chromeX.ok) return chromeX;
    } catch {
      /* network */
    }
  }

  const fbUrl = buildFallbackFetchUrl(pageUrl);
  if (fbUrl) {
    throwIfAborted(externalSignal);
    try {
      const fbRes = await fetchWithRetry(fbUrl, buildWebFetchInit("primary"), cfg);
      if (fbRes.ok) return fbRes;
    } catch {
      /* network */
    }
  }

  return primary;
}

async function runWebFetchInner(
  urlIn: string,
  maxChars: number,
  opts: { includeAssets?: boolean; assetsMax?: number } | undefined,
  externalSignal: AbortSignal
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const url = unwrapRedirectUrl(urlIn);
  const urlBlock = refuseBinaryWebFetchUrl(url);
  if (urlBlock) return { ok: false, error: urlBlock };

  const includeAssets = opts?.includeAssets ?? false;
  const assetsMax = Math.max(1, Math.min(100, opts?.assetsMax ?? 30));
  const timeoutMs = resolveWebFetchTimeoutMs();
  const retries = resolveWebFetchRetries();
  const maxBackoff = resolveWebFetchMaxRetryDelayMs();
  const chunkIdleMs = resolveWebFetchBodyChunkIdleMs(timeoutMs);

  const retried = await obtainWebFetchResponse(url, externalSignal, timeoutMs, retries, maxBackoff);

  if (!retried.ok) {
    let err =
      `HTTP ${retried.status} ${retried.statusText}. ` +
      `If the page needs cookies, a logged-in session, or client-side JS, try browser_open / browser_act or http_request with custom headers. ` +
      `Optional: AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE (e.g. reader proxy), AGENT_WEB_FETCH_403_RETRY=0 to disable bot-wall retries (Firefox + Chrome cross-site).`;
    if (retried.status === 403 || retried.status === 401) {
      try {
        const host = new URL(url).hostname;
        if (
          /sciencedirect|springer|ieee|jstor|acm\.org|nature\.com|wiley|tandfonline|cell\.com|elsevier/i.test(
            host
          )
        ) {
          err += " Many academic publishers block non-browser clients (403). ";
        }
      } catch {
        /* ignore */
      }
    }
    return { ok: false, error: err };
  }

  const clBytes = parseContentLength(retried.headers);
  if (clBytes !== null && clBytes > RESPONSE_BODY_WARN_BYTES) {
    return {
      ok: false,
      error: `Refusing body ~${clBytes} bytes (>${RESPONSE_BODY_WARN_BYTES}); choose a smaller page or raise AGENT_WEB_FETCH max env if you truly need it.`,
    };
  }

  const ct = (retried.headers.get("content-type") ?? "").toLowerCase();
  const ctBlock = refuseBinaryWebFetchContentType(retried.headers.get("content-type") ?? "");
  if (ctBlock) return { ok: false, error: ctBlock };
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
      const ab = await readResponseArrayBufferWithCap(retried, PDF_MAX_BYTES, externalSignal, chunkIdleMs);
      const raw = Buffer.from(ab);
      const buf = raw.byteLength > PDF_MAX_BYTES ? raw.subarray(0, PDF_MAX_BYTES) : raw;
      const data = await pdfParse(buf);
      const text = (data.text ?? "").replace(/\s+/g, " ").trim();
      const note = raw.byteLength > PDF_MAX_BYTES ? `\n[PDF truncated to first ${PDF_MAX_BYTES} bytes for parse]` : "";
      return { ok: true, output: (text.slice(0, maxChars) + note).slice(0, maxChars + 200) };
    } catch (e) {
      return { ok: false, error: `PDF parse failed: ${String(e)}` };
    }
  }

  const maxPre = resolveWebFetchMaxPreprocessChars();
  const downloadCap = Math.min(MAX_DOWNLOAD_TEXT_BYTES, Math.max(maxPre + 50_000, 500_000));
  const charsetLabel = resolveTextDecoderLabel(parseCharsetFromContentType(retried.headers.get("content-type")));
  const textRaw = await readResponseTextWithCap(
    retried,
    downloadCap,
    externalSignal,
    charsetLabel,
    chunkIdleMs
  );
  const ctLooksText =
    ct.includes("text/") || ct.includes("html") || ct.includes("xml") || ct.includes("javascript") || ct.length === 0;
  if (ctLooksText && looksLikeDecodedBinaryGarbage(textRaw)) {
    return {
      ok: false,
      error:
        "web_fetch: decoded body looks like binary or corrupted text (mislabeled content-type, undecoded compression, or a JS bundle). " +
        "Try browser_open / browser_act, http_request, or a different URL.",
    };
  }
  const truncatedNote = textRaw.length > maxPre ? `\n[HTML truncated from ${textRaw.length} to ${maxPre} chars before parse]` : "";
  const text = textRaw.length > maxPre ? textRaw.slice(0, maxPre) : textRaw;

  const readable = await extractReadableHtml(text, url, { signal: externalSignal });
  const body =
    readable ??
    text
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const bodyOut = (body + truncatedNote).trim();

  if (!includeAssets) {
    return { ok: true, output: bodyOut.slice(0, maxChars) };
  }

  const assets = extractPageAssets(text, url, assetsMax);
  const sections: string[] = [bodyOut.slice(0, maxChars)];
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
}

export async function runWebFetch(
  urlIn: string,
  maxChars: number,
  opts?: { includeAssets?: boolean; assetsMax?: number }
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const wallMs = resolveWebFetchTotalWallMs();
  const budget = new AbortController();
  const kill = setTimeout(() => budget.abort(), wallMs);
  try {
    return await runWebFetchInner(urlIn, maxChars, opts, budget.signal);
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    const msg = String(err ?? "");
    if (budget.signal.aborted || name === "AbortError" || /aborted|abort/i.test(msg)) {
      return {
        ok: false,
        error:
          `web_fetch: exceeded total wall time ${wallMs}ms (network + retries + parse). ` +
          `Tune AGENT_WEB_FETCH_TOTAL_WALL_MS, AGENT_WEB_FETCH_TIMEOUT_MS (per attempt), ` +
          `AGENT_WEB_FETCH_RETRIES, AGENT_WEB_FETCH_RETRY_MAX_DELAY_MS, or avoid many parallel web_fetch calls.`,
      };
    }
    return { ok: false, error: msg };
  } finally {
    clearTimeout(kill);
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
    "WHAT: Fetch URL content as plain text. Refuses obvious binary/archive/installer URL suffixes (e.g. .gz, .zip, .exe, .dmg) and matching Content-Type values before downloading. Optional discovery of useful links and image URLs from the page for follow-up browsing/vision. Strips HTML; with AGENT_WEB_READABILITY=1 runs Mozilla Readability inside JSDOM on **only the first N characters** of HTML (`AGENT_WEB_FETCH_READABILITY_MAX_INPUT_CHARS`, default 72000) so huge pages + parallel `web_fetch` cannot freeze the Node process for many minutes. Author style/script tags are stripped before parse (JSDOM cannot parse many modern stylesheets). PDFs → text when pdf-parse available. Direct image URLs return metadata + vision hint.\n" +
    "RELIABILITY: Chromium-style navigation fingerprint (Accept incl. avif/webp/sxg, Sec-Fetch-*, Priority, gzip/deflate/br — not zstd, to avoid servers returning encodings some Node builds decode poorly; optional Sec-CH-UA* when UA is Chrome-like — tune with AGENT_WEB_FETCH_USER_AGENT, AGENT_WEB_FETCH_SEC_CH_PLATFORM, AGENT_WEB_FETCH_ACCEPT_LANGUAGE, AGENT_WEB_FETCH_REFERER for cross-site retries). On HTTP 403/401 after a bot-wall body peek: retries Firefox+Referer (AGENT_WEB_FETCH_ALT_USER_AGENT), then Chrome+Referer+cross-site, then optional AGENT_WEB_FETCH_FALLBACK_URL_TEMPLATE `{url}` reader proxy. Disable extra retries with AGENT_WEB_FETCH_403_RETRY=0. TLS fingerprint is still Node's — hard paywalls / heavy bot scores need browser_open or a real browser proxy.\n" +
    "TIME: Per-attempt timeout AGENT_WEB_FETCH_TIMEOUT_MS (default 20s) covers **headers + body** for each GET (not TTFB-only). Retries AGENT_WEB_FETCH_RETRIES (default 2); **hard total wall** AGENT_WEB_FETCH_TOTAL_WALL_MS (default 55s) aborts the whole call—avoid many parallel web_fetch on slow news sites.\n" +
    "WHEN: You already have the exact URL — use web_search first to find it.\n" +
    "NOT WHEN: The question is broad discovery across many sites — prefer web_search or an orchestrated multi-fetch flow instead of blind URL guesses.\n" +
    "GOOD OUTPUT: Clean article text or structured error you can cite; mention hostname and char limits when summarizing for the user.\n" +
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
    const hostname = (() => {
      try {
        return new URL(url).hostname;
      } catch {
        return url.slice(0, 50);
      }
    })();
    emit?.(`\nfetching ${hostname}…\n`);
    const result = await runWebFetch(url, maxChars, { includeAssets, assetsMax });
    if (result.ok) emit?.(`  ✓ ${result.output.length} chars\n`);
    return result;
  },
});
