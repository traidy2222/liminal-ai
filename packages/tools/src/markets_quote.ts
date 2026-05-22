import { defineTool } from "./helpers.js";
import { fetchWithRetry } from "./network_retry.js";
import { effectiveHarnessEnvRaw } from "@liminal/core";

const DEFAULT_MARKETS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";

function marketsUserAgent(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_WEB_FETCH_USER_AGENT")?.trim() || DEFAULT_MARKETS_UA
  );
}

type AssetType = "equity_etf" | "fx" | "commodity" | "crypto";

interface NormalizedRequest {
  input: string;
  requestedAssetType: AssetType | "auto";
  assetType: AssetType;
  canonicalSymbol: string;
  providerSymbol: string;
}

interface NormalizedQuote {
  input_symbol: string;
  symbol: string;
  asset_type: AssetType;
  price: number | null;
  currency: string | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  change_pct: number | null;
  as_of: string | null;
  source: string;
  fallback_level: "primary" | "secondary" | "tertiary" | "none";
  is_live: boolean;
  delay_seconds: number | null;
  confidence: "high" | "medium" | "low";
  uncertainty_note: string;
}

const COMMODITY_ALIASES: Record<string, string> = {
  gold: "GC=F",
  xauusd: "XAUUSD=X",
  silver: "SI=F",
  xagusd: "XAGUSD=X",
  wti: "CL=F",
  crude: "CL=F",
  oil: "CL=F",
  brent: "BZ=F",
  naturalgas: "NG=F",
};

function parseAssetType(raw: unknown): AssetType | "auto" {
  const value = String(raw ?? "auto").trim().toLowerCase();
  if (value === "equity_etf" || value === "fx" || value === "commodity" || value === "crypto") {
    return value;
  }
  return "auto";
}

function parseMaxDelaySeconds(): number {
  const raw = Number(effectiveHarnessEnvRaw("AGENT_MARKETS_MAX_DELAY_MS") ?? "2000");
  if (!Number.isFinite(raw)) return 900;
  return Math.max(30, Math.min(86_400, Math.floor(raw / 1000)));
}

function parseTimeoutMs(): number {
  const n = Number(effectiveHarnessEnvRaw("AGENT_MARKETS_TIMEOUT_MS") ?? "8000");
  if (!Number.isFinite(n)) return 12_000;
  return Math.max(3_000, Math.min(60_000, Math.round(n)));
}

function parseRetries(): number {
  const n = Number(effectiveHarnessEnvRaw("AGENT_MARKETS_RETRIES") ?? "2");
  if (!Number.isFinite(n)) return 3;
  return Math.max(0, Math.min(8, Math.round(n)));
}

function normalizeFxSymbol(value: string): string {
  const compact = value.replace(/[^A-Za-z]/g, "").toUpperCase();
  if (compact.length === 6) return `${compact}=X`;
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(value.toUpperCase())) {
    return `${value.replace("/", "").toUpperCase()}=X`;
  }
  return value.toUpperCase();
}

function normalizeCryptoSymbol(value: string): string {
  const upper = value.trim().toUpperCase();
  if (/^[A-Z0-9]+[-/][A-Z0-9]+$/.test(upper)) {
    return upper.replace("/", "-");
  }
  return `${upper}-USD`;
}

function inferAssetType(symbol: string): AssetType {
  const upper = symbol.toUpperCase();
  if (upper.endsWith("=X") || /^[A-Z]{6}$/.test(upper.replace("=X", ""))) return "fx";
  if (upper.includes("-USD") || upper.includes("/USD")) return "crypto";
  if (upper.endsWith("=F") || COMMODITY_ALIASES[upper.toLowerCase()]) return "commodity";
  return "equity_etf";
}

function normalizeOneSymbol(inputRaw: string, requestedAssetType: AssetType | "auto"): NormalizedRequest {
  const input = inputRaw.trim();
  const lower = input.toLowerCase().replace(/\s+/g, "");
  const commodityAlias = COMMODITY_ALIASES[lower];
  if (commodityAlias) {
    return {
      input,
      requestedAssetType,
      assetType: "commodity",
      canonicalSymbol: commodityAlias,
      providerSymbol: commodityAlias,
    };
  }

  const inferred = requestedAssetType === "auto" ? inferAssetType(input) : requestedAssetType;
  if (inferred === "fx") {
    const s = normalizeFxSymbol(input);
    return { input, requestedAssetType, assetType: "fx", canonicalSymbol: s, providerSymbol: s };
  }
  if (inferred === "crypto") {
    const s = normalizeCryptoSymbol(input);
    return { input, requestedAssetType, assetType: "crypto", canonicalSymbol: s, providerSymbol: s };
  }
  if (inferred === "commodity") {
    const upper = input.toUpperCase();
    const s = upper.endsWith("=F") || upper.endsWith("=X") ? upper : `${upper}=F`;
    return { input, requestedAssetType, assetType: "commodity", canonicalSymbol: s, providerSymbol: s };
  }
  const eq = input.toUpperCase();
  return { input, requestedAssetType, assetType: "equity_etf", canonicalSymbol: eq, providerSymbol: eq };
}

async function fetchYahooQuotes(
  requests: NormalizedRequest[],
  timeoutMs: number,
  retries: number
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const symbols = requests.map((r) => r.providerSymbol).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": marketsUserAgent() } }, { timeoutMs, maxRetries: retries });
  if (!res.ok) throw new Error(`Yahoo quote HTTP ${res.status}`);
  const json = (await res.json()) as {
    quoteResponse?: { result?: Array<Record<string, unknown>> };
  };
  for (const row of json.quoteResponse?.result ?? []) {
    const k = String(row["symbol"] ?? "").trim();
    if (k) out.set(k, row);
  }
  return out;
}

async function fetchCoinbaseTicker(symbol: string, timeoutMs: number, retries: number): Promise<NormalizedQuote | null> {
  const pair = symbol.toUpperCase().replace("/", "-");
  const url = `https://api.exchange.coinbase.com/products/${encodeURIComponent(pair)}/ticker`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": marketsUserAgent() } }, { timeoutMs, maxRetries: retries });
  if (!res.ok) return null;
  const json = (await res.json()) as Record<string, unknown>;
  const price = Number(json["price"]);
  if (!Number.isFinite(price)) return null;
  const time = String(json["time"] ?? "");
  const asOf = time ? new Date(time).toISOString() : null;
  const delaySeconds = asOf ? Math.max(0, Math.round((Date.now() - Date.parse(asOf)) / 1000)) : null;
  const maxDelay = parseMaxDelaySeconds();
  const isLive = delaySeconds !== null && delaySeconds <= maxDelay;
  return {
    input_symbol: symbol,
    symbol: pair,
    asset_type: "crypto",
    price,
    currency: pair.split("-")[1] ?? "USD",
    bid: Number.isFinite(Number(json["bid"])) ? Number(json["bid"]) : null,
    ask: Number.isFinite(Number(json["ask"])) ? Number(json["ask"]) : null,
    change: null,
    change_pct: null,
    as_of: asOf,
    source: "coinbase-exchange",
    fallback_level: "secondary",
    is_live: isLive,
    delay_seconds: delaySeconds,
    confidence: isLive ? "high" : "medium",
    uncertainty_note: isLive
      ? "Near-real-time crypto ticker from free exchange endpoint."
      : "Ticker timestamp is delayed or unavailable; treat as best-effort.",
  };
}

async function fetchStooqFallback(
  req: NormalizedRequest,
  timeoutMs: number,
  retries: number
): Promise<NormalizedQuote | null> {
  const upper = req.canonicalSymbol.toUpperCase();
  const base =
    req.assetType === "equity_etf"
      ? req.canonicalSymbol.toLowerCase().includes(".")
        ? req.canonicalSymbol.toLowerCase()
        : `${req.canonicalSymbol.toLowerCase()}.us`
      : req.assetType === "fx"
      ? upper.replace("=X", "").toLowerCase()
      : req.assetType === "commodity"
      ? upper.endsWith("=F")
        ? upper === "BZ=F"
          ? "cb.f"
          : `${upper.slice(0, -2).toLowerCase()}.f`
        : upper === "XAUUSD=X"
        ? "xauusd"
        : upper === "XAGUSD=X"
        ? "xagusd"
        : upper.replace("=X", "").toLowerCase()
      : req.canonicalSymbol.replace(/=X|=F/g, "").toLowerCase();
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(base)}&f=sd2t2ohlcvn&e=csv`;
  const res = await fetchWithRetry(url, { headers: { "User-Agent": marketsUserAgent() } }, { timeoutMs, maxRetries: retries });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1) return null;
  const first = lines[0] ?? "";
  const second = lines[1] ?? "";
  const line = /^symbol,/i.test(first) ? second : first;
  if (!line) return null;
  const cols = line.split(",");
  if (cols.length < 9) return null;
  const date = cols[1]?.trim() ?? "";
  const time = cols[2]?.trim() ?? "";
  const close = Number(cols[6]);
  if (!Number.isFinite(close)) return null;
  const asOf =
    date && date !== "N/D"
      ? new Date(`${date}T${time && time !== "N/D" ? time : "00:00:00"}Z`).toISOString()
      : null;
  const delaySeconds = asOf ? Math.max(0, Math.round((Date.now() - Date.parse(asOf)) / 1000)) : null;
  const maxDelay = parseMaxDelaySeconds();
  const isLive = delaySeconds !== null && delaySeconds <= maxDelay;
  return {
    input_symbol: req.input,
    symbol: req.canonicalSymbol,
    asset_type: req.assetType,
    price: close,
    currency: req.assetType === "fx" ? req.canonicalSymbol.slice(3, 6) : "USD",
    bid: null,
    ask: null,
    change: null,
    change_pct: null,
    as_of: asOf,
    source: "stooq",
    fallback_level: "primary",
    is_live: isLive,
    delay_seconds: delaySeconds,
    confidence: isLive ? "medium" : "low",
    uncertainty_note:
      "Fallback quote from free endpoint. Timestamp or market depth may be limited compared with primary providers.",
  };
}

function normalizeFromYahoo(req: NormalizedRequest, row: Record<string, unknown>): NormalizedQuote {
  const asOfEpoch = Number(row["regularMarketTime"]);
  const asOf = Number.isFinite(asOfEpoch) && asOfEpoch > 0 ? new Date(asOfEpoch * 1000).toISOString() : null;
  const delaySeconds = asOf ? Math.max(0, Math.round((Date.now() - Date.parse(asOf)) / 1000)) : null;
  const maxDelay = parseMaxDelaySeconds();
  const isLive = delaySeconds !== null && delaySeconds <= maxDelay;
  const change = Number(row["regularMarketChange"]);
  const changePct = Number(row["regularMarketChangePercent"]);
  return {
    input_symbol: req.input,
    symbol: String(row["symbol"] ?? req.canonicalSymbol),
    asset_type: req.assetType,
    price: Number.isFinite(Number(row["regularMarketPrice"])) ? Number(row["regularMarketPrice"]) : null,
    currency: String(row["currency"] ?? row["financialCurrency"] ?? "").trim() || null,
    bid: Number.isFinite(Number(row["bid"])) ? Number(row["bid"]) : null,
    ask: Number.isFinite(Number(row["ask"])) ? Number(row["ask"]) : null,
    change: Number.isFinite(change) ? change : null,
    change_pct: Number.isFinite(changePct) ? changePct : null,
    as_of: asOf,
    source: "yahoo-finance",
    fallback_level: "primary",
    is_live: isLive,
    delay_seconds: delaySeconds,
    confidence: isLive ? "high" : "medium",
    uncertainty_note: isLive
      ? "Best-effort near-real-time quote from free endpoint."
      : "Quote appears delayed for this symbol/exchange; use as provisional.",
  };
}

export const marketsQuoteTool = defineTool({
  name: "markets_quote",
  description:
    "WHAT: Retrieve best-effort near-real-time free market quotes for equities/ETFs, FX, commodities, and crypto with fallback and freshness metadata.\n" +
    "WHEN: Pricing, costing, conversion, valuation, or market snapshot tasks require up-to-date values.\n" +
    "ARGS: symbols (string[]), optional asset_type (auto|equity_etf|fx|commodity|crypto).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 30_000,
  parameters: {
    type: "object",
    properties: {
      symbols: {
        type: "array",
        description: "List of symbols or aliases (e.g., AAPL, EURUSD, gold, BTC-USD)",
        items: { type: "string", minLength: 1, maxLength: 40 },
      },
      asset_type: {
        type: "string",
        enum: ["auto", "equity_etf", "fx", "commodity", "crypto"],
        description: "Optional routing hint. Default auto.",
      },
    },
    required: ["symbols"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    try {
      const symbolsRaw = Array.isArray(args["symbols"]) ? (args["symbols"] as unknown[]) : [];
      const symbols = symbolsRaw.map((s) => String(s ?? "").trim()).filter(Boolean);
      if (symbols.length === 0) return { ok: false, error: "markets_quote requires at least one symbol." };
      const requestedAssetType = parseAssetType(args["asset_type"]);
      const normalized = symbols.map((s) => normalizeOneSymbol(s, requestedAssetType));
      const timeoutMs = parseTimeoutMs();
      const retries = parseRetries();
      emit?.(`\nmarkets_quote: querying ${symbols.join(", ")} via Yahoo Finance…\n`);
      const yahooMap = await fetchYahooQuotes(normalized, timeoutMs, retries).catch(
        () => new Map<string, Record<string, unknown>>()
      );

      const quotes: NormalizedQuote[] = [];
      for (const req of normalized) {
        const stooqPrimary = await fetchStooqFallback(req, timeoutMs, retries);
        if (stooqPrimary) {
          quotes.push(stooqPrimary);
          continue;
        }
        if (req.assetType === "crypto") {
          const cryptoFallback = await fetchCoinbaseTicker(req.canonicalSymbol, timeoutMs, retries);
          if (cryptoFallback) {
            quotes.push({ ...cryptoFallback, input_symbol: req.input });
            continue;
          }
        }
        const yahooRow = yahooMap.get(req.providerSymbol);
        if (yahooRow && Number.isFinite(Number(yahooRow["regularMarketPrice"]))) {
          const secondary = normalizeFromYahoo(req, yahooRow);
          quotes.push({ ...secondary, fallback_level: "secondary" });
          continue;
        }
        quotes.push({
          input_symbol: req.input,
          symbol: req.canonicalSymbol,
          asset_type: req.assetType,
          price: null,
          currency: null,
          bid: null,
          ask: null,
          change: null,
          change_pct: null,
          as_of: null,
          source: "unavailable",
          fallback_level: "none",
          is_live: false,
          delay_seconds: null,
          confidence: "low",
          uncertainty_note:
            "No free provider returned a usable quote for this symbol right now. Try alternate ticker or retry shortly.",
        });
      }

      const result = {
        requested_symbols: symbols,
        quote_count: quotes.length,
        as_of: new Date().toISOString(),
        provider_mode: "free_best_effort",
        quotes,
      };
      return { ok: true, output: JSON.stringify(result, null, 2) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  },
});
