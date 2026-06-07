/**
 * Liminal desktop app specs — typed, persisted, non-executable UI definitions.
 */

import { repairWidgetHtmlDocument } from "./widget_html_merge.js";

export const LIMINAL_APP_SPEC_V = 1 as const;

export type LiminalAppType = "weather" | "html" | "markdown" | "chart" | "table" | "iframe";

export type LiminalAppSource = "model" | "user";

export type HtmlInteractivity = "static" | "sandbox";

export interface LiminalAppRefresh {
  interval_min: number;
}

export interface LiminalAppPlacement {
  width: number;
  height: number;
  x?: number;
  y?: number;
}

export type LiminalAppShellMode = "widget" | "window";

export interface LiminalAppShell {
  mode: LiminalAppShellMode;
  frameless?: boolean;
  always_on_top?: boolean;
  skip_taskbar?: boolean;
  /** 0.5–1.0 */
  opacity?: number;
}

export function defaultShellForType(_type: LiminalAppType): LiminalAppShell {
  return {
    mode: "widget",
    frameless: true,
    always_on_top: false,
    skip_taskbar: false,
    opacity: 1,
  };
}

export function normalizeAppShell(raw: unknown, type: LiminalAppType): LiminalAppShell {
  const base = defaultShellForType(type);
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Record<string, unknown>;
  const mode = o["mode"] === "window" ? "window" : "widget";
  const opacityRaw = Number(o["opacity"]);
  const opacity =
    Number.isFinite(opacityRaw) && opacityRaw >= 0.5 && opacityRaw <= 1
      ? opacityRaw
      : base.opacity;
  return {
    mode,
    frameless: o["frameless"] === false ? false : mode === "widget",
    always_on_top: o["always_on_top"] === true,
    skip_taskbar: o["skip_taskbar"] === true,
    opacity,
  };
}

export interface AppDataFetch {
  url: string;
  method?: "GET" | "POST";
}

export interface LiminalAppSpec {
  v: typeof LIMINAL_APP_SPEC_V;
  id: string;
  type: LiminalAppType;
  title: string;
  props: Record<string, unknown>;
  refresh?: LiminalAppRefresh;
  placement?: LiminalAppPlacement;
  shell?: LiminalAppShell;
  /** When true, desktop opens this app's window on startup. */
  auto_open?: boolean;
  created_at: number;
  updated_at: number;
  source: LiminalAppSource;
}

export interface AppCacheEntry {
  fetched_at: number;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface WeatherAppProps {
  location: string;
  country_hint?: string;
  units?: "metric" | "imperial";
}

export interface LiminalAppTypeMeta {
  type: LiminalAppType;
  label: string;
  description: string;
  defaultTitle: string;
  defaultRefreshMin: number;
  defaultPlacement: LiminalAppPlacement;
  propsSchema: Record<string, unknown>;
}

export const LIMINAL_APP_TYPES: readonly LiminalAppTypeMeta[] = [
  {
    type: "weather",
    label: "Weather",
    description: "Live weather for a place (Open-Meteo), refreshes on a timer in a desktop window.",
    defaultTitle: "Weather",
    defaultRefreshMin: 45,
    defaultPlacement: { width: 300, height: 240 },
    propsSchema: {
      type: "object",
      properties: {
        location: { type: "string", minLength: 2, maxLength: 160 },
        country_hint: { type: "string", minLength: 2, maxLength: 2 },
        units: { type: "string", enum: ["metric", "imperial"] },
      },
      required: ["location"],
    },
  },
  {
    type: "html",
    label: "HTML widget",
    description:
      "Agent-authored HTML/JS UI in a sandboxed desktop window. Use for dashboards, calculators, custom layouts.",
    defaultTitle: "Widget",
    defaultRefreshMin: 30,
    defaultPlacement: { width: 420, height: 480 },
    propsSchema: {
      type: "object",
      properties: {
        html: { type: "string", description: "Inline HTML body or full document" },
        interactivity: { type: "string", enum: ["static", "sandbox"] },
        data_fetch: {
          type: "object",
          properties: {
            url: { type: "string" },
            method: { type: "string", enum: ["GET", "POST"] },
          },
          required: ["url"],
        },
        proxy_hosts: { type: "array", items: { type: "string" } },
      },
    },
  },
  {
    type: "markdown",
    label: "Markdown panel",
    description: "Live markdown document in a desktop window.",
    defaultTitle: "Notes",
    defaultRefreshMin: 60,
    defaultPlacement: { width: 360, height: 320 },
    propsSchema: {
      type: "object",
      properties: {
        markdown: { type: "string" },
        content: { type: "string", description: "Alias for markdown" },
      },
      required: ["markdown"],
    },
  },
  {
    type: "chart",
    label: "Chart",
    description: "Simple bar/line chart from labels + series.",
    defaultTitle: "Chart",
    defaultRefreshMin: 30,
    defaultPlacement: { width: 380, height: 280 },
    propsSchema: {
      type: "object",
      properties: {
        chart: { type: "string", enum: ["bar", "line"] },
        labels: { type: "array", items: { type: "string" } },
        series: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              values: { type: "array", items: { type: "number" } },
            },
          },
        },
        title: { type: "string" },
        data_fetch: { type: "object" },
      },
      required: ["labels", "series"],
    },
  },
  {
    type: "table",
    label: "Table",
    description: "Sortable data table in a desktop window.",
    defaultTitle: "Table",
    defaultRefreshMin: 60,
    defaultPlacement: { width: 420, height: 360 },
    propsSchema: {
      type: "object",
      properties: {
        columns: { type: "array", items: { type: "string" } },
        rows: { type: "array", items: { type: "array" } },
        sortable: { type: "boolean" },
      },
      required: ["columns", "rows"],
    },
  },
  {
    type: "iframe",
    label: "Web embed",
    description: "HTTPS iframe embed (allowlisted host only).",
    defaultTitle: "Web",
    defaultRefreshMin: 60,
    defaultPlacement: { width: 480, height: 360 },
    propsSchema: {
      type: "object",
      properties: {
        src: { type: "string", description: "https:// URL" },
      },
      required: ["src"],
    },
  },
] as const;

const SECRET_LIKE = /api[_-]?key|secret|token|password|bearer/i;

export function getAppTypeMeta(type: string): LiminalAppTypeMeta | undefined {
  return LIMINAL_APP_TYPES.find((t) => t.type === type);
}

export function isHtmlCapableType(type: LiminalAppType): boolean {
  return type !== "weather";
}

export function sanitizeAppId(raw: string): string {
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return s || "app";
}

export function defaultAppId(type: LiminalAppType, hint?: string): string {
  const base = hint ? sanitizeAppId(hint) : type;
  return sanitizeAppId(`${type}_${base}`).slice(0, 48);
}

function rejectSecretProps(props: Record<string, unknown>): { ok: true } | { ok: false; error: string } {
  for (const [k, v] of Object.entries(props)) {
    if (SECRET_LIKE.test(k)) return { ok: false, error: `props key "${k}" is not allowed.` };
    if (typeof v === "string" && SECRET_LIKE.test(v) && v.length > 20) {
      return { ok: false, error: `props.${k} looks like a secret value.` };
    }
  }
  return { ok: true };
}

export function validateWeatherAppProps(props: Record<string, unknown>): {
  ok: true;
  props: WeatherAppProps;
} | { ok: false; error: string } {
  const location = String(props["location"] ?? "").trim();
  if (location.length < 2 || location.length > 160) {
    return { ok: false, error: "weather props.location must be 2–160 characters." };
  }
  const countryHint = props["country_hint"];
  if (countryHint !== undefined && countryHint !== null && String(countryHint).trim() !== "") {
    const c = String(countryHint).trim();
    if (!/^[A-Za-z]{2}$/.test(c)) {
      return { ok: false, error: "weather props.country_hint must be ISO-2." };
    }
  }
  const unitsRaw = props["units"];
  const units =
    unitsRaw === "imperial" ? "imperial" : unitsRaw === "metric" ? "metric" : undefined;
  if (unitsRaw !== undefined && unitsRaw !== null && String(unitsRaw).trim() !== "" && !units) {
    return { ok: false, error: 'weather props.units must be "metric" or "imperial".' };
  }
  const sec = rejectSecretProps(props);
  if (!sec.ok) return sec;
  return {
    ok: true,
    props: {
      location,
      ...(countryHint ? { country_hint: String(countryHint).trim().toUpperCase() } : {}),
      ...(units ? { units } : {}),
    },
  };
}

function parseDataFetch(raw: unknown): AppDataFetch | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const url = String(o["url"] ?? "").trim();
  if (!url.startsWith("http://") && !url.startsWith("https://")) return undefined;
  const methodRaw = String(o["method"] ?? "GET").toUpperCase();
  const method = methodRaw === "POST" ? "POST" : "GET";
  return { url, method };
}

function parseProxyHosts(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = raw.map((h) => String(h ?? "").trim().toLowerCase()).filter(Boolean);
  return out.length > 0 ? out : undefined;
}

export function validateHtmlAppProps(props: Record<string, unknown>): {
  ok: true;
  props: Record<string, unknown>;
} | { ok: false; error: string } {
  const html = String(props["html"] ?? "").trim();
  if (!html && props["html_ref"] !== true) {
    return { ok: false, error: "html props require html body or html_ref." };
  }
  const sec = rejectSecretProps(props);
  if (!sec.ok) return sec;
  const interRaw = String(props["interactivity"] ?? "sandbox").toLowerCase();
  const interactivity: HtmlInteractivity = interRaw === "static" ? "static" : "sandbox";
  const data_fetch = parseDataFetch(props["data_fetch"]);
  const proxy_hosts = parseProxyHosts(props["proxy_hosts"]);
  return {
    ok: true,
    props: {
      ...(html ? { html } : {}),
      ...(props["html_ref"] === true ? { html_ref: true } : {}),
      interactivity,
      ...(data_fetch ? { data_fetch } : {}),
      ...(proxy_hosts ? { proxy_hosts } : {}),
    },
  };
}

export function validateMarkdownAppProps(props: Record<string, unknown>): {
  ok: true;
  props: Record<string, unknown>;
} | { ok: false; error: string } {
  const md = String(props["markdown"] ?? props["content"] ?? "").trim();
  if (md.length < 1) return { ok: false, error: "markdown props.markdown is required." };
  if (md.length > 200_000) return { ok: false, error: "markdown too large (max 200k chars)." };
  const sec = rejectSecretProps(props);
  if (!sec.ok) return sec;
  return { ok: true, props: { markdown: md } };
}

export function validateChartAppProps(props: Record<string, unknown>): {
  ok: true;
  props: Record<string, unknown>;
} | { ok: false; error: string } {
  const labels = Array.isArray(props["labels"]) ? props["labels"].map(String) : [];
  if (labels.length === 0) return { ok: false, error: "chart props.labels required." };
  const seriesRaw = props["series"];
  if (!Array.isArray(seriesRaw) || seriesRaw.length === 0) {
    return { ok: false, error: "chart props.series required." };
  }
  const chart = String(props["chart"] ?? "bar").toLowerCase() === "line" ? "line" : "bar";
  const sec = rejectSecretProps(props);
  if (!sec.ok) return sec;
  const data_fetch = parseDataFetch(props["data_fetch"]);
  return {
    ok: true,
    props: {
      chart,
      labels,
      series: seriesRaw,
      ...(props["title"] ? { title: String(props["title"]).slice(0, 80) } : {}),
      ...(data_fetch ? { data_fetch } : {}),
    },
  };
}

export function validateTableAppProps(props: Record<string, unknown>): {
  ok: true;
  props: Record<string, unknown>;
} | { ok: false; error: string } {
  const columns = Array.isArray(props["columns"]) ? props["columns"].map(String) : [];
  const rows = Array.isArray(props["rows"]) ? props["rows"] : [];
  if (columns.length === 0) return { ok: false, error: "table props.columns required." };
  const sec = rejectSecretProps(props);
  if (!sec.ok) return sec;
  return {
    ok: true,
    props: {
      columns,
      rows,
      sortable: props["sortable"] === true,
    },
  };
}

export function validateIframeAppProps(props: Record<string, unknown>): {
  ok: true;
  props: Record<string, unknown>;
} | { ok: false; error: string } {
  const src = String(props["src"] ?? "").trim();
  if (!src.startsWith("https://")) {
    return { ok: false, error: "iframe props.src must be https:// URL." };
  }
  const sec = rejectSecretProps(props);
  if (!sec.ok) return sec;
  return { ok: true, props: { src } };
}

export function validateAppProps(
  type: LiminalAppType,
  props: Record<string, unknown>
): { ok: true; props: Record<string, unknown> } | { ok: false; error: string } {
  switch (type) {
    case "weather": {
      const w = validateWeatherAppProps(props);
      if (!w.ok) return w;
      return { ok: true, props: { ...w.props } };
    }
    case "html":
      return validateHtmlAppProps(props);
    case "markdown":
      return validateMarkdownAppProps(props);
    case "chart":
      return validateChartAppProps(props);
    case "table":
      return validateTableAppProps(props);
    case "iframe":
      return validateIframeAppProps(props);
    default:
      return { ok: false, error: `Unknown app type: ${type}` };
  }
}

export function normalizeAppSpec(raw: unknown, opts?: { source?: LiminalAppSource }): LiminalAppSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const type = String(o["type"] ?? "") as LiminalAppType;
  const meta = getAppTypeMeta(type);
  if (!meta) return null;

  const propsIn = o["props"];
  const propsObj =
    propsIn && typeof propsIn === "object" && !Array.isArray(propsIn)
      ? (propsIn as Record<string, unknown>)
      : {};
  const validated = validateAppProps(type, propsObj);
  if (!validated.ok) return null;

  const id = sanitizeAppId(String(o["id"] ?? defaultAppId(type)));
  const title = String(o["title"] ?? meta.defaultTitle).trim().slice(0, 80) || meta.defaultTitle;
  const now = Date.now();

  const refreshRaw = o["refresh"];
  let refresh: LiminalAppRefresh | undefined;
  if (refreshRaw && typeof refreshRaw === "object") {
    const ri = (refreshRaw as Record<string, unknown>)["interval_min"];
    const n = typeof ri === "number" ? ri : Number(ri);
    if (Number.isFinite(n) && n >= 5 && n <= 24 * 60) {
      refresh = { interval_min: Math.round(n) };
    }
  }
  if (!refresh) refresh = { interval_min: meta.defaultRefreshMin };

  const placementRaw = o["placement"];
  let placement: LiminalAppPlacement = { ...meta.defaultPlacement };
  if (placementRaw && typeof placementRaw === "object") {
    const p = placementRaw as Record<string, unknown>;
    const w = Number(p["width"]);
    const h = Number(p["height"]);
    if (Number.isFinite(w) && w >= 200 && w <= 1200) placement.width = Math.round(w);
    if (Number.isFinite(h) && h >= 150 && h <= 900) placement.height = Math.round(h);
    const x = Number(p["x"]);
    const y = Number(p["y"]);
    if (Number.isFinite(x)) placement.x = Math.round(x);
    if (Number.isFinite(y)) placement.y = Math.round(y);
  }

  const shell = normalizeAppShell(o["shell"], type);

  const created = typeof o["created_at"] === "number" ? o["created_at"] : now;
  const updated = typeof o["updated_at"] === "number" ? o["updated_at"] : now;
  const source = o["source"] === "user" ? "user" : opts?.source ?? "model";

  return {
    v: LIMINAL_APP_SPEC_V,
    id,
    type,
    title,
    props: validated.props,
    refresh,
    placement,
    shell,
    auto_open: o["auto_open"] === true,
    created_at: created,
    updated_at: updated,
    source,
  };
}

export interface SpawnAppInput {
  type: LiminalAppType;
  id?: string;
  title?: string;
  props: Record<string, unknown>;
  refresh?: LiminalAppRefresh;
  placement?: LiminalAppPlacement;
  shell?: LiminalAppShell;
  auto_open?: boolean;
  source?: LiminalAppSource;
}

export function buildAppSpecFromSpawn(input: SpawnAppInput): { ok: true; spec: LiminalAppSpec } | { ok: false; error: string } {
  const meta = getAppTypeMeta(input.type);
  if (!meta) return { ok: false, error: `Unknown app type: ${input.type}` };
  const validated = validateAppProps(input.type, input.props);
  if (!validated.ok) return validated;

  const hint =
    input.type === "weather"
      ? (validated.props["location"] as string | undefined)
      : input.title ?? input.type;
  const id = sanitizeAppId(input.id ?? defaultAppId(input.type, hint));
  const now = Date.now();
  const spec: LiminalAppSpec = {
    v: LIMINAL_APP_SPEC_V,
    id,
    type: input.type,
    title: (input.title ?? meta.defaultTitle).trim().slice(0, 80) || meta.defaultTitle,
    props: validated.props,
    refresh: input.refresh ?? { interval_min: meta.defaultRefreshMin },
    placement: input.placement ?? { ...meta.defaultPlacement },
    shell: normalizeAppShell(input.shell, input.type),
    auto_open: input.auto_open !== false,
    created_at: now,
    updated_at: now,
    source: input.source ?? "model",
  };
  return { ok: true, spec };
}

/** Legacy threshold — html widgets now always persist to ~/.liminal/apps/html/. */
export const HTML_INLINE_MAX_CHARS = 16_000;

export async function normalizeHtmlPropsForPersist(
  appId: string,
  props: Record<string, unknown>,
  writeHtml: (id: string, html: string) => Promise<string>
): Promise<Record<string, unknown>> {
  const html = repairWidgetHtmlDocument(String(props["html"] ?? "").trim());
  if (!html) return props;
  await writeHtml(appId, html);
  const next = { ...props };
  delete next["html"];
  next["html_ref"] = true;
  return next;
}
