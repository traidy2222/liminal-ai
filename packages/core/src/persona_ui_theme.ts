/**
 * Persona-scoped UI theme (presentation-only JSON). Validated and normalized for
 * contrast on dark HUD backgrounds; never interpreted as code or CSS.
 */

export const PERSONA_UI_THEME_VERSION = 1 as const;

export type PersonaUiMotionPreset = "calm" | "default" | "snappy" | "dramatic";

/** Canonical JARVIS defaults (web + document CSS). */
export const DEFAULT_PERSONA_UI_THEME: PersonaUiThemeV1 = {
  v: 1,
  accent: "#00d4ff",
  secondary: "#ff4488",
  warn: "#ffb347",
  danger: "#ff2244",
  success: "#00ff88",
  muted: "#778899",
  surfaceTint: "#0a1018",
  displayLabel: "Liminal",
  motion: "default",
};

export interface PersonaUiThemeV1 {
  v: typeof PERSONA_UI_THEME_VERSION;
  accent: string;
  secondary: string;
  warn: string;
  danger: string;
  success: string;
  muted: string;
  /** Subtle panel tint (hex). */
  surfaceTint: string;
  /** Short HUD title (max 24 chars after normalize). */
  displayLabel: string;
  motion: PersonaUiMotionPreset;
}

const BG = parseHexToRgb("#020408")!;
const MIN_CONTRAST_NORMAL = 4.5;
const MAX_LABEL = 24;

const INK_CANDIDATES: Array<{ name: string; rgb: [number, number, number] }> = [
  { name: "cyan", rgb: [0, 212, 255] },
  { name: "magenta", rgb: [255, 68, 136] },
  { name: "green", rgb: [0, 255, 136] },
  { name: "yellow", rgb: [255, 179, 71] },
  { name: "red", rgb: [255, 34, 68] },
  { name: "blue", rgb: [68, 170, 255] },
  { name: "gray", rgb: [119, 136, 153] },
  { name: "white", rgb: [255, 255, 255] },
];

export function parseHexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const s = hex.trim();
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s);
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) {
    h = `${h[0]}${h[0]}${h[1]}${h[1]}${h[2]}${h[2]}`;
  }
  const n = parseInt(h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[c(r), c(g), c(b)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Relative luminance sRGB (WCAG). */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(rgb.r);
  const G = lin(rgb.g);
  const B = lin(rgb.b);
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrastRatio(fg: { r: number; g: number; b: number }, bg: { r: number; g: number; b: number }): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const a = Math.max(L1, L2);
  const b = Math.min(L1, L2);
  return (a + 0.05) / (b + 0.05);
}

function boostContrastOnBg(fg: { r: number; g: number; b: number }, bg: typeof BG, minRatio: number): { r: number; g: number; b: number } {
  let cur = { ...fg };
  for (let i = 0; i < 28; i++) {
    if (contrastRatio(cur, bg) >= minRatio) return cur;
    // Lerp toward white to lift luminance on dark bg
    cur = {
      r: cur.r + (255 - cur.r) * 0.12,
      g: cur.g + (255 - cur.g) * 0.12,
      b: cur.b + (255 - cur.b) * 0.12,
    };
  }
  return { r: 220, g: 230, b: 240 };
}

function sanitizeHex(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const rgb = parseHexToRgb(input);
  if (!rgb) return fallback;
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function normalizeMotion(input: unknown): PersonaUiMotionPreset {
  const m = typeof input === "string" ? input.trim().toLowerCase() : "";
  if (m === "calm" || m === "default" || m === "snappy" || m === "dramatic") return m;
  return "default";
}

function clampLabel(s: string, fallback: string): string {
  const t = s.replace(/[\u0000-\u001f<>]/g, "").trim();
  if (!t) return fallback;
  return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL) : t;
}

/**
 * Merge unknown JSON with defaults, fix hex strings, enforce contrast vs dark HUD bg,
 * clamp display label length. Safe for untrusted model output.
 */
export function validateAndNormalizePersonaUiTheme(raw: unknown, profileDisplayName?: string): PersonaUiThemeV1 {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallbackName = clampLabel(profileDisplayName ?? "", DEFAULT_PERSONA_UI_THEME.displayLabel);

  let accent = sanitizeHex(o["accent"], DEFAULT_PERSONA_UI_THEME.accent);
  let secondary = sanitizeHex(o["secondary"], DEFAULT_PERSONA_UI_THEME.secondary);
  let warn = sanitizeHex(o["warn"], DEFAULT_PERSONA_UI_THEME.warn);
  let danger = sanitizeHex(o["danger"], DEFAULT_PERSONA_UI_THEME.danger);
  let success = sanitizeHex(o["success"], DEFAULT_PERSONA_UI_THEME.success);
  let muted = sanitizeHex(o["muted"], DEFAULT_PERSONA_UI_THEME.muted);
  let surfaceTint = sanitizeHex(o["surfaceTint"], DEFAULT_PERSONA_UI_THEME.surfaceTint);

  let accentRgb = parseHexToRgb(accent)!;
  let secondaryRgb = parseHexToRgb(secondary)!;
  let warnRgb = parseHexToRgb(warn)!;
  let dangerRgb = parseHexToRgb(danger)!;
  let successRgb = parseHexToRgb(success)!;
  let mutedRgb = parseHexToRgb(muted)!;

  accentRgb = boostContrastOnBg(accentRgb, BG, MIN_CONTRAST_NORMAL);
  secondaryRgb = boostContrastOnBg(secondaryRgb, BG, 3.8);
  warnRgb = boostContrastOnBg(warnRgb, BG, 3.5);
  dangerRgb = boostContrastOnBg(dangerRgb, BG, 3.5);
  successRgb = boostContrastOnBg(successRgb, BG, 3.2);
  mutedRgb = boostContrastOnBg(mutedRgb, BG, 3);

  const surfaceRgb = parseHexToRgb(surfaceTint)!;
  const surfaceBoosted = {
    r: Math.min(40, surfaceRgb.r + 8),
    g: Math.min(48, surfaceRgb.g + 10),
    b: Math.min(56, surfaceRgb.b + 12),
  };

  const labelRaw = typeof o["displayLabel"] === "string" ? o["displayLabel"] : "";
  const displayLabel = clampLabel(labelRaw, fallbackName);

  return {
    v: 1,
    accent: rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b),
    secondary: rgbToHex(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b),
    warn: rgbToHex(warnRgb.r, warnRgb.g, warnRgb.b),
    danger: rgbToHex(dangerRgb.r, dangerRgb.g, dangerRgb.b),
    success: rgbToHex(successRgb.r, successRgb.g, successRgb.b),
    muted: rgbToHex(mutedRgb.r, mutedRgb.g, mutedRgb.b),
    surfaceTint: rgbToHex(surfaceBoosted.r, surfaceBoosted.g, surfaceBoosted.b),
    displayLabel,
    motion: normalizeMotion(o["motion"]),
  };
}

/** Map hex theme to nearest Ink named color for terminal chrome. */
export function mapPersonaUiThemeToInk(theme: PersonaUiThemeV1): Record<
  "accent" | "secondary" | "warn" | "danger" | "success" | "muted",
  string
> {
  const pick = (hex: string) => {
    const rgb = parseHexToRgb(hex);
    if (!rgb) return "cyan";
    let best = INK_CANDIDATES[0]!;
    let bestD = Infinity;
    for (const c of INK_CANDIDATES) {
      const d =
        (rgb.r - c.rgb[0]) ** 2 + (rgb.g - c.rgb[1]) ** 2 + (rgb.b - c.rgb[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best.name;
  };
  return {
    accent: pick(theme.accent),
    secondary: pick(theme.secondary),
    warn: pick(theme.warn),
    danger: pick(theme.danger),
    success: pick(theme.success),
    muted: pick(theme.muted),
  };
}

export function motionPresetToStatusBarIntervalMs(motion: PersonaUiMotionPreset): number {
  switch (motion) {
    case "calm":
      return 110;
    case "snappy":
      return 55;
    case "dramatic":
      return 70;
    default:
      return 80;
  }
}

export function motionPresetToCssMultipliers(motion: PersonaUiMotionPreset): {
  orbIdle: number;
  orbSpin: number;
  orbThink: number;
  orbApprov: number;
  blink: number;
} {
  switch (motion) {
    case "calm":
      return { orbIdle: 1.35, orbSpin: 1.2, orbThink: 1.25, orbApprov: 1.2, blink: 1.15 };
    case "snappy":
      return { orbIdle: 0.72, orbSpin: 0.55, orbThink: 0.65, orbApprov: 0.62, blink: 0.7 };
    case "dramatic":
      return { orbIdle: 0.92, orbSpin: 0.75, orbThink: 0.88, orbApprov: 0.8, blink: 0.85 };
    default:
      return { orbIdle: 1, orbSpin: 1, orbThink: 1, orbApprov: 1, blink: 1 };
  }
}
