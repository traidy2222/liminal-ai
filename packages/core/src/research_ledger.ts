/**
 * ResearchLedger — per-send research workspace state.
 *
 * The audit complaint that drove this: the harness behaves like a breadth-first
 * search engine when it should behave like a hypothesis-driven researcher. The
 * root cause is **situational blindness**: the model has no compact view of
 * what it has already searched, which URLs were surfaced, which were fetched,
 * which fetches succeeded, which intent buckets are covered.
 *
 * The ledger is that view. Every search query and every fetch outcome is
 * recorded as it happens, URLs are canonicalized and deduplicated across
 * search engines and redirect wrappers, and a compact summary is injected
 * into the model's context before each round so it can self-regulate.
 *
 * Multidomain by design: no topic detection, no per-domain rules. The ledger
 * tracks *behavior*, not subject matter — what was searched, fetched, and
 * left pending. It works identically for nuclear-reactor research, codebase
 * exploration, market analysis, or anything else that uses web tools.
 */

// ─── URL canonicalization ────────────────────────────────────────────────────

const TRACKING_PARAM_RE = /^(utm_|ref$|ref_|fbclid$|gclid$|msclkid$|mc_|_ga$|_gl$|igshid$|si$|spm$|cmpid$|rut$)/i;

/**
 * Unwrap a search-engine redirect URL when present. DuckDuckGo embeds the real
 * target in `?uddg=<urlencoded>`; Google in `?q=` (for `/url`); Bing in `?u=`.
 * Returns the inner URL on success, otherwise the original input.
 */
export function unwrapSearchRedirect(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase();
    if (host.includes("duckduckgo.com") && parsed.pathname.startsWith("/l")) {
      const inner = parsed.searchParams.get("uddg");
      if (inner) return inner;
    }
    if (host.includes("google.") && parsed.pathname === "/url") {
      const inner = parsed.searchParams.get("q") ?? parsed.searchParams.get("url");
      if (inner) return inner;
    }
    if (host.includes("bing.com") && parsed.pathname.startsWith("/ck/")) {
      const inner = parsed.searchParams.get("u");
      if (inner) return inner;
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

/**
 * Canonical form for dedup: lowercase host, no tracking params, no fragment,
 * no trailing slash on path. Preserves query params that matter (anything not
 * matching the tracking-param regex).
 */
export function canonicalUrl(input: string): string {
  const unwrapped = unwrapSearchRedirect(input.trim());
  try {
    const u = new URL(unwrapped);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase();
    const kept: [string, string][] = [];
    for (const [k, v] of u.searchParams.entries()) {
      if (TRACKING_PARAM_RE.test(k)) continue;
      kept.push([k, v]);
    }
    u.search = "";
    // Strip trailing slash from path before re-adding query, so we get
    // "https://host/Article?id=42" not "https://host/Article/?id=42".
    if (u.pathname !== "/" && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    for (const [k, v] of kept) u.searchParams.append(k, v);
    return u.toString();
  } catch {
    return unwrapped;
  }
}

// ─── URL extraction from arbitrary tool output ────────────────────────────────

const RAW_URL_RE = /https?:\/\/[^\s"'<>)\]}]+/g;

/**
 * Extract every URL from a tool result body. Strips trailing punctuation that
 * commonly leaks in from prose ("...example.com." → "...example.com").
 */
export function extractUrls(body: string): string[] {
  const found = body.match(RAW_URL_RE) ?? [];
  const cleaned: string[] = [];
  for (const raw of found) {
    const trimmed = raw.replace(/[.,;:!?]+$/, "").replace(/[)\]]+$/, "");
    cleaned.push(trimmed);
  }
  return cleaned;
}

/**
 * Pull a one-line title from text immediately around a URL. Used to give each
 * surfaced result a human-readable label in the ledger. Conservative: takes
 * the line before the URL when it looks like a title (capitalized, no URL).
 */
function inferTitleFromContext(body: string, urlIndex: number): string {
  const before = body.slice(Math.max(0, urlIndex - 240), urlIndex);
  const lines = before.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (RAW_URL_RE.test(line)) continue;
    if (line.length < 4) continue;
    // Strip numbered-list prefix like "1. " or "1) "
    return line.replace(/^[0-9]+[.)]\s*/, "").slice(0, 140);
  }
  return "";
}

// ─── Ledger data model ───────────────────────────────────────────────────────

export type UrlStatus =
  | "pending" // surfaced in a search result but not yet fetched
  | "fetched_ok"
  | "fetched_fail"
  | "fetching"; // in-flight (PASTE speculation, etc.)

export interface UrlRecord {
  url: string; // canonical form
  raw: string; // first raw form seen, for display
  title: string; // best-effort title from search result context
  status: UrlStatus;
  /** Index into queries[] of the search that first surfaced this URL. */
  firstSeenQueryIdx: number;
  /** Word count of fetched body when status is fetched_ok. */
  fetchedWordCount?: number;
  /** Short error string when status is fetched_fail. */
  fetchError?: string;
  /** First seen at (ms since epoch). */
  firstSeenAt: number;
  /** Last status change at (ms since epoch). */
  updatedAt: number;
}

export interface QueryRecord {
  query: string;
  /** Comma-joined intent tokens — useful for grouping. */
  intentKey: string;
  /** URLs surfaced by this exact query, in display order (canonical form). */
  surfaced: string[];
  /** ok=false if the search itself failed. */
  ok: boolean;
  at: number;
}

export interface LedgerSummary {
  searchCount: number;
  uniqueQueryCount: number;
  urlInventoryCount: number;
  fetchedOk: number;
  fetchedFail: number;
  pending: number;
}

// ─── Class ────────────────────────────────────────────────────────────────────

export class ResearchLedger {
  private readonly queries: QueryRecord[] = [];
  private readonly urls = new Map<string, UrlRecord>();
  /**
   * Monotonic version counter — bumped whenever the ledger changes. Used by
   * the agent loop to decide whether to re-inject the [RESEARCH STATE] block
   * for the current round.
   */
  private version = 0;

  // ── Recording ─────────────────────────────────────────────────────────────

  /**
   * Record a web_search call. `body` is the raw tool result text — the ledger
   * extracts URLs and infers titles itself, so no per-tool schema coupling.
   */
  recordSearch(query: string, body: string, ok: boolean): void {
    const q = query.trim();
    if (!q) return;
    const intentKey = q
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3)
      .sort()
      .join(",");
    const surfaced: string[] = [];
    if (ok) {
      const seenInThisSearch = new Set<string>();
      const matches: { raw: string; idx: number }[] = [];
      let m;
      const re = new RegExp(RAW_URL_RE.source, "g");
      while ((m = re.exec(body)) !== null) {
        const raw = m[0].replace(/[.,;:!?]+$/, "").replace(/[)\]]+$/, "");
        matches.push({ raw, idx: m.index });
      }
      const queryIdx = this.queries.length; // index of the about-to-push record
      for (const { raw, idx } of matches) {
        const canon = canonicalUrl(raw);
        if (!canon || seenInThisSearch.has(canon)) continue;
        seenInThisSearch.add(canon);
        surfaced.push(canon);
        const existing = this.urls.get(canon);
        if (!existing) {
          this.urls.set(canon, {
            url: canon,
            raw,
            title: inferTitleFromContext(body, idx),
            status: "pending",
            firstSeenQueryIdx: queryIdx,
            firstSeenAt: Date.now(),
            updatedAt: Date.now(),
          });
        }
      }
    }
    this.queries.push({
      query: q,
      intentKey,
      surfaced,
      ok,
      at: Date.now(),
    });
    this.version += 1;
  }

  /** Record a web_fetch outcome by URL. */
  recordFetch(url: string, ok: boolean, body?: string, errorMessage?: string): void {
    const canon = canonicalUrl(url);
    if (!canon) return;
    const existing = this.urls.get(canon);
    const now = Date.now();
    if (existing) {
      existing.status = ok ? "fetched_ok" : "fetched_fail";
      existing.updatedAt = now;
      if (ok && body) {
        existing.fetchedWordCount = body.trim().split(/\s+/).length;
      } else if (!ok && errorMessage) {
        existing.fetchError = errorMessage.slice(0, 200);
      }
    } else {
      // Direct fetch of a URL never surfaced in any search — track anyway.
      this.urls.set(canon, {
        url: canon,
        raw: url,
        title: "",
        status: ok ? "fetched_ok" : "fetched_fail",
        firstSeenQueryIdx: -1,
        firstSeenAt: now,
        updatedAt: now,
        fetchedWordCount: ok && body ? body.trim().split(/\s+/).length : undefined,
        fetchError: !ok && errorMessage ? errorMessage.slice(0, 200) : undefined,
      });
    }
    this.version += 1;
  }

  /** Mark a URL as fetching — useful for predictive PASTE speculation visibility. */
  recordFetchStart(url: string): void {
    const canon = canonicalUrl(url);
    if (!canon) return;
    const existing = this.urls.get(canon);
    if (existing && existing.status === "pending") {
      existing.status = "fetching";
      existing.updatedAt = Date.now();
      this.version += 1;
    }
  }

  // ── Inspection ────────────────────────────────────────────────────────────

  getVersion(): number {
    return this.version;
  }

  isEmpty(): boolean {
    return this.queries.length === 0 && this.urls.size === 0;
  }

  summary(): LedgerSummary {
    let fetchedOk = 0;
    let fetchedFail = 0;
    let pending = 0;
    for (const r of this.urls.values()) {
      if (r.status === "fetched_ok") fetchedOk += 1;
      else if (r.status === "fetched_fail") fetchedFail += 1;
      else pending += 1;
    }
    const intentKeys = new Set(this.queries.map((q) => q.intentKey));
    return {
      searchCount: this.queries.length,
      uniqueQueryCount: intentKeys.size,
      urlInventoryCount: this.urls.size,
      fetchedOk,
      fetchedFail,
      pending,
    };
  }

  getQueries(): readonly QueryRecord[] {
    return this.queries;
  }

  /** Return URLs filtered by status; oldest first. */
  getUrls(filter?: { status?: UrlStatus | UrlStatus[] }): UrlRecord[] {
    let out = [...this.urls.values()];
    if (filter?.status) {
      const allowed = new Set<UrlStatus>(
        Array.isArray(filter.status) ? filter.status : [filter.status]
      );
      out = out.filter((r) => allowed.has(r.status));
    }
    out.sort((a, b) => a.firstSeenAt - b.firstSeenAt);
    return out;
  }

  /** Pending URLs — surfaced in some search but not yet fetched. */
  getPendingUrls(): UrlRecord[] {
    return this.getUrls({ status: "pending" });
  }

  /**
   * Format a compact block suitable for [RESEARCH STATE] injection.
   * Designed to stay under ~1 KB even with dozens of URLs, so the model has
   * a workspace view without bloating the context.
   */
  formatContextBlock(): string {
    if (this.isEmpty()) return "";
    const s = this.summary();
    const lines: string[] = [];
    lines.push(
      `[RESEARCH STATE] searches=${s.searchCount} uniq_intent=${s.uniqueQueryCount} ` +
        `urls=${s.urlInventoryCount} fetched_ok=${s.fetchedOk} fetched_fail=${s.fetchedFail} pending=${s.pending}`
    );
    if (this.queries.length > 0) {
      const recent = this.queries.slice(-6);
      lines.push("recent queries:");
      for (const q of recent) {
        const status = q.ok ? `${q.surfaced.length} urls` : "FAILED";
        lines.push(`  • "${q.query.slice(0, 90)}" (${status})`);
      }
    }
    const pending = this.getPendingUrls().slice(0, 8);
    if (pending.length > 0) {
      lines.push(`pending fetches (${this.getPendingUrls().length} total, showing ${pending.length}):`);
      for (const u of pending) {
        const t = u.title ? `${u.title.slice(0, 60)} — ` : "";
        lines.push(`  • ${t}${u.url.slice(0, 120)}`);
      }
    }
    const fetched = this.getUrls({ status: "fetched_ok" }).slice(-4);
    if (fetched.length > 0) {
      lines.push(`recent successful fetches:`);
      for (const u of fetched) {
        const wc = u.fetchedWordCount != null ? ` (${u.fetchedWordCount}w)` : "";
        lines.push(`  • ${u.url.slice(0, 100)}${wc}`);
      }
    }
    const failed = this.getUrls({ status: "fetched_fail" }).slice(-3);
    if (failed.length > 0) {
      lines.push(`recent fetch failures:`);
      for (const u of failed) {
        lines.push(`  • ${u.url.slice(0, 100)}${u.fetchError ? ` — ${u.fetchError.slice(0, 60)}` : ""}`);
      }
    }
    const attempts = s.fetchedOk + s.fetchedFail;
    if (s.fetchedFail >= 3 && attempts >= 4 && s.fetchedFail / attempts >= 0.5) {
      lines.push(
        "⚠ high fetch failure rate — stop parallel spray. Prefer web_fetch on hostnames (not https://<IP>:port via http_request), " +
          "browser_* for bot walls, run_shell curl with Host header, or synthesize from evidence the user already pasted."
      );
    }
    lines.push(
      "use research_state for full inventory, query_tool_outputs to retrieve prior search bodies, " +
        "or fetch a pending URL directly with web_fetch."
    );
    return lines.join("\n");
  }

  /** Reset for a new send. */
  clear(): void {
    this.queries.length = 0;
    this.urls.clear();
    this.version = 0;
  }
}
