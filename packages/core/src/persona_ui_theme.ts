/**
 * Persona-scoped UI theme (presentation-only JSON). Validated and normalized for
 * contrast on dark HUD backgrounds; never interpreted as code or CSS.
 */

export const PERSONA_UI_THEME_V1 = 1 as const;
export const PERSONA_UI_THEME_V2 = 2 as const;

export type PersonaUiMotionPreset = "calm" | "default" | "snappy" | "dramatic";
export type PersonaUiShell = "hud" | "terminal" | "studio" | "minimal";
export type PersonaUiDensity = "compact" | "comfortable" | "spacious";
export type PersonaUiRadius = "sharp" | "soft" | "pill";
export type PersonaUiTypography = "mono" | "sans" | "mixed";
export type PersonaUiMessageStyle = "bubble" | "flat" | "transcript";
export type PersonaUiOrbStyle = "ring" | "pulse" | "dot" | "hidden";
export type PersonaUiBackground = "solid" | "grid" | "scanline" | "gradient";

/** Curated font pairings — each maps to a Google Fonts URL + CSS stack. */
export type PersonaUiFontPair =
  | "system"          // OS defaults (no external load)
  | "ibm-plex"        // IBM Plex Sans + IBM Plex Mono — structured, technical
  | "jetbrains"       // JetBrains Mono only — terminal-native, no prose font
  | "inter-cascadia"  // Inter + Cascadia Code — modern UI + dev aesthetic
  | "playfair"        // Playfair Display + Source Sans 3 — editorial, formal
  | "geist";          // Geist Sans + Geist Mono — minimal, Vercel-style

/** How the input area looks and feels. */
export type PersonaUiInputStyle =
  | "default"   // current behavior — rounded textarea with border
  | "command"   // CLI-style: `>` prefix, full-width monospace dark bar
  | "document"  // word-processor feel: taller, light inner glow, serif hint
  | "minimal";  // single underline only, no box, maximally unobtrusive

/** Message identity indicator style. */
export type PersonaUiAvatarStyle =
  | "orb"    // animated orb (current behavior)
  | "glyph"  // 1–2 char glyph at message start (uses avatarGlyph field)
  | "stripe" // colored left-edge stripe on assistant messages
  | "none";  // no avatar — text-only

/** Tool call card rendering density. */
export type PersonaUiToolCards =
  | "verbose"  // current: expanded by default, shows args + output preview
  | "compact"  // icon + name + status only, collapsed by default
  | "log"      // single-line stdout style: `[✓] tool_name · arg`
  | "hidden";  // tool calls not shown in conversation

/** How new messages enter the view. */
export type PersonaUiMessageEntrance = "instant" | "fade" | "slide" | "typewriter";

/** Top chrome presence and style. */
export type PersonaUiHeaderStyle = "bar" | "pill" | "none";
/** Which side panels are active. */
export type PersonaUiPanelLayout = "both" | "left" | "right" | "none";
/** Where the input area is docked. */
export type PersonaUiInputDock = "bottom-bar" | "floating" | "inline";

export type PersonaCategoryKey =
  | "shell"
  | "file"
  | "web"
  | "memory"
  | "vault"
  | "code"
  | "git"
  | "markets"
  | "vision"
  | "docs"
  | "orchestration"
  | "context"
  | "other";

export const PERSONA_CATEGORY_KEYS: readonly PersonaCategoryKey[] = [
  "shell",
  "file",
  "web",
  "memory",
  "vault",
  "code",
  "git",
  "markets",
  "vision",
  "docs",
  "orchestration",
  "context",
  "other",
] as const;

export type PersonaCategoryTint = Partial<Record<PersonaCategoryKey, string>>;

/** @deprecated Use PersonaUiThemeV2 — kept for migration input. */
export interface PersonaUiThemeV1 {
  v: typeof PERSONA_UI_THEME_V1;
  accent: string;
  secondary: string;
  warn: string;
  danger: string;
  success: string;
  muted: string;
  surfaceTint: string;
  displayLabel: string;
  motion: PersonaUiMotionPreset;
}

export interface PersonaUiThemeV2 {
  v: typeof PERSONA_UI_THEME_V2;
  accent: string;
  secondary: string;
  warn: string;
  danger: string;
  success: string;
  muted: string;
  surfaceTint: string;
  displayLabel: string;
  motion: PersonaUiMotionPreset;
  shell: PersonaUiShell;
  density: PersonaUiDensity;
  radius: PersonaUiRadius;
  typography: PersonaUiTypography;
  messageStyle: PersonaUiMessageStyle;
  orbStyle: PersonaUiOrbStyle;
  background: PersonaUiBackground;
  categoryTint?: PersonaCategoryTint;
  // Extended appearance fields
  fontPair: PersonaUiFontPair;
  backgroundCss?: string;          // model-generated CSS gradient string (sanitized)
  inputStyle: PersonaUiInputStyle;
  avatarStyle: PersonaUiAvatarStyle;
  avatarGlyph?: string;            // 1–2 char glyph; only used when avatarStyle="glyph"
  toolCards: PersonaUiToolCards;
  messageEntrance: PersonaUiMessageEntrance;
  headerStyle: PersonaUiHeaderStyle;
  panelLayout: PersonaUiPanelLayout;
  inputDock: PersonaUiInputDock;
}

/** Canonical defaults (web + document CSS). */
export const DEFAULT_PERSONA_UI_THEME: PersonaUiThemeV2 = {
  v: 2,
  accent: "#00d4ff",
  secondary: "#ff4488",
  warn: "#ffb347",
  danger: "#ff2244",
  success: "#00ff88",
  muted: "#778899",
  surfaceTint: "#0a1018",
  displayLabel: "Liminal",
  motion: "default",
  shell: "hud",
  density: "comfortable",
  radius: "soft",
  typography: "mixed",
  messageStyle: "bubble",
  orbStyle: "ring",
  background: "grid",
  fontPair: "system",
  inputStyle: "default",
  avatarStyle: "orb",
  toolCards: "verbose",
  messageEntrance: "instant",
  headerStyle: "bar",
  panelLayout: "both",
  inputDock: "bottom-bar",
};

export type PersonaUiTheme = PersonaUiThemeV2;

const DARK_BG_FALLBACK = parseHexToRgb("#020408")!;

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

const MAX_LABEL = 24;
const MIN_CONTRAST_NORMAL = 4.5;

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

function rgbTriplet(rgb: { r: number; g: number; b: number }): string {
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
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

export function contrastRatio(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number }
): number {
  const L1 = relativeLuminance(fg);
  const L2 = relativeLuminance(bg);
  const a = Math.max(L1, L2);
  const b = Math.min(L1, L2);
  return (a + 0.05) / (b + 0.05);
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
        break;
      case gn:
        h = ((bn - rn) / d + 2) / 6;
        break;
      default:
        h = ((rn - gn) / d + 4) / 6;
        break;
    }
  }
  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const hue2rgb = (p: number, q: number, t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}

/** Boost contrast while preserving hue (avoids every persona converging on washed-out cyan-white). */
function boostContrastOnBg(
  fg: { r: number; g: number; b: number },
  bg: { r: number; g: number; b: number },
  minRatio: number
): { r: number; g: number; b: number } {
  let { h, s, l } = rgbToHsl(fg.r, fg.g, fg.b);
  for (let i = 0; i < 36; i++) {
    const cur = hslToRgb(h, s, l);
    if (contrastRatio(cur, bg) >= minRatio) return cur;
    l = Math.min(0.94, l + 0.035);
    s = Math.min(1, s + 0.025);
  }
  return hslToRgb(h, Math.min(1, s + 0.05), 0.9);
}

/** Darken while keeping surfaceTint hue (maroon vs teal backgrounds stay distinct). */
function darkenPreservingHue(rgb: { r: number; g: number; b: number }, floor = 4): { r: number; g: number; b: number } {
  const max = Math.max(rgb.r, rgb.g, rgb.b, 1);
  const targetMax = Math.max(floor, Math.min(max, 56));
  if (max <= targetMax) return rgb;
  const scale = targetMax / max;
  return {
    r: Math.max(floor, rgb.r * scale),
    g: Math.max(floor, rgb.g * scale),
    b: Math.max(floor, rgb.b * scale),
  };
}

function sanitizeHex(input: unknown, fallback: string): string {
  if (typeof input !== "string") return fallback;
  const rgb = parseHexToRgb(input);
  if (!rgb) return fallback;
  return rgbToHex(rgb.r, rgb.g, rgb.b);
}

function normalizeEnum<T extends string>(input: unknown, allowed: readonly T[], fallback: T): T {
  const m = typeof input === "string" ? input.trim().toLowerCase() : "";
  return (allowed as readonly string[]).includes(m) ? (m as T) : fallback;
}

function normalizeMotion(input: unknown): PersonaUiMotionPreset {
  return normalizeEnum(input, ["calm", "default", "snappy", "dramatic"] as const, "default");
}

function clampLabel(s: string, fallback: string): string {
  const t = s.replace(/[\u0000-\u001f<>]/g, "").trim();
  if (!t) return fallback;
  return t.length > MAX_LABEL ? t.slice(0, MAX_LABEL) : t;
}

const FONT_PAIR_VALUES = ["system", "ibm-plex", "jetbrains", "inter-cascadia", "playfair", "geist"] as const;
const INPUT_STYLE_VALUES = ["default", "command", "document", "minimal"] as const;
const AVATAR_STYLE_VALUES = ["orb", "glyph", "stripe", "none"] as const;
const TOOL_CARDS_VALUES = ["verbose", "compact", "log", "hidden"] as const;
const MSG_ENTRANCE_VALUES = ["instant", "fade", "slide", "typewriter"] as const;
const HEADER_STYLE_VALUES = ["bar", "pill", "none"] as const;
const PANEL_LAYOUT_VALUES = ["both", "left", "right", "none"] as const;
const INPUT_DOCK_VALUES = ["bottom-bar", "floating", "inline"] as const;

function sanitizeBackgroundCss(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const s = raw.trim();
  if (!s) return undefined;
  // Block anything that could be malicious
  if (/url\s*\(|expression\s*\(|javascript:|@import/i.test(s)) return undefined;
  // Must start with a CSS gradient function
  if (!/^(linear-gradient|radial-gradient|conic-gradient)\s*\(/i.test(s)) return undefined;
  return s.length > 400 ? s.slice(0, 400) : s;
}

function sanitizeAvatarGlyph(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const t = raw.replace(/[ -<>&"]/g, "").trim();
  if (!t) return undefined;
  // Limit to a short display string (emoji can be multi-codepoint)
  return [...t].slice(0, 3).join("") || undefined;
}

function normalizeCategoryTint(raw: unknown): PersonaCategoryTint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const out: PersonaCategoryTint = {};
  for (const key of PERSONA_CATEGORY_KEYS) {
    const v = o[key];
    if (typeof v === "string" && parseHexToRgb(v)) {
      out[key] = sanitizeHex(v, DEFAULT_PERSONA_UI_THEME.accent);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeColorFields(o: Record<string, unknown>, fallbackName: string) {
  let accent = sanitizeHex(o["accent"], DEFAULT_PERSONA_UI_THEME.accent);
  let secondary = sanitizeHex(o["secondary"], DEFAULT_PERSONA_UI_THEME.secondary);
  let warn = sanitizeHex(o["warn"], DEFAULT_PERSONA_UI_THEME.warn);
  let danger = sanitizeHex(o["danger"], DEFAULT_PERSONA_UI_THEME.danger);
  let success = sanitizeHex(o["success"], DEFAULT_PERSONA_UI_THEME.success);
  let muted = sanitizeHex(o["muted"], DEFAULT_PERSONA_UI_THEME.muted);
  let surfaceTint = sanitizeHex(o["surfaceTint"], DEFAULT_PERSONA_UI_THEME.surfaceTint);

  const bgRgb = parseHexToRgb(surfaceTint) ?? DARK_BG_FALLBACK;
  const bgForContrast = darkenPreservingHue(bgRgb, 4);

  let accentRgb = boostContrastOnBg(parseHexToRgb(accent)!, bgForContrast, MIN_CONTRAST_NORMAL);
  let secondaryRgb = boostContrastOnBg(parseHexToRgb(secondary)!, bgForContrast, 3.8);
  let warnRgb = boostContrastOnBg(parseHexToRgb(warn)!, bgForContrast, 3.5);
  let dangerRgb = boostContrastOnBg(parseHexToRgb(danger)!, bgForContrast, 3.5);
  let successRgb = boostContrastOnBg(parseHexToRgb(success)!, bgForContrast, 3.2);
  let mutedRgb = boostContrastOnBg(parseHexToRgb(muted)!, bgForContrast, 3);

  const surfaceRgb = parseHexToRgb(surfaceTint)!;
  const surfaceBoosted = {
    r: Math.min(72, Math.max(6, surfaceRgb.r + 10)),
    g: Math.min(80, Math.max(6, surfaceRgb.g + 12)),
    b: Math.min(88, Math.max(6, surfaceRgb.b + 14)),
  };

  const labelRaw = typeof o["displayLabel"] === "string" ? o["displayLabel"] : "";
  const displayLabel = clampLabel(labelRaw, fallbackName);

  return {
    accent: rgbToHex(accentRgb.r, accentRgb.g, accentRgb.b),
    secondary: rgbToHex(secondaryRgb.r, secondaryRgb.g, secondaryRgb.b),
    warn: rgbToHex(warnRgb.r, warnRgb.g, warnRgb.b),
    danger: rgbToHex(dangerRgb.r, dangerRgb.g, dangerRgb.b),
    success: rgbToHex(successRgb.r, successRgb.g, successRgb.b),
    muted: rgbToHex(mutedRgb.r, mutedRgb.g, mutedRgb.b),
    surfaceTint: rgbToHex(surfaceBoosted.r, surfaceBoosted.g, surfaceBoosted.b),
    displayLabel,
    motion: normalizeMotion(o["motion"]),
    categoryTint: normalizeCategoryTint(o["categoryTint"]),
  };
}

/** Migrate v1 or partial JSON to v2 with defaults for new fields. */
export function migratePersonaUiTheme(raw: unknown): PersonaUiThemeV2 {
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o["v"] === 2) {
      return validateAndNormalizePersonaUiTheme(raw);
    }
    if (o["v"] === 1) {
      const colors = normalizeColorFields(o, DEFAULT_PERSONA_UI_THEME.displayLabel);
      return {
        v: 2,
        ...colors,
        shell: "hud",
        density: "comfortable",
        radius: "soft",
        typography: "mixed",
        messageStyle: "bubble",
        orbStyle: "ring",
        background: "grid",
        fontPair: "system",
        inputStyle: "default",
        avatarStyle: "orb",
        toolCards: "verbose",
        messageEntrance: "instant",
        headerStyle: "bar",
        panelLayout: "both",
        inputDock: "bottom-bar",
      };
    }
  }
  return validateAndNormalizePersonaUiTheme(raw);
}

/**
 * Merge unknown JSON with defaults, fix hex strings, enforce contrast vs dark HUD bg,
 * clamp display label length. Safe for untrusted model output.
 */
export function validateAndNormalizePersonaUiTheme(
  raw: unknown,
  profileDisplayName?: string
): PersonaUiThemeV2 {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fallbackName = clampLabel(profileDisplayName ?? "", DEFAULT_PERSONA_UI_THEME.displayLabel);
  const colors = normalizeColorFields(o, fallbackName);

  return {
    v: 2,
    ...colors,
    shell: normalizeEnum(o["shell"], ["hud", "terminal", "studio", "minimal"] as const, DEFAULT_PERSONA_UI_THEME.shell),
    density: normalizeEnum(
      o["density"],
      ["compact", "comfortable", "spacious"] as const,
      DEFAULT_PERSONA_UI_THEME.density
    ),
    radius: normalizeEnum(o["radius"], ["sharp", "soft", "pill"] as const, DEFAULT_PERSONA_UI_THEME.radius),
    typography: normalizeEnum(
      o["typography"],
      ["mono", "sans", "mixed"] as const,
      DEFAULT_PERSONA_UI_THEME.typography
    ),
    messageStyle: normalizeEnum(
      o["messageStyle"],
      ["bubble", "flat", "transcript"] as const,
      DEFAULT_PERSONA_UI_THEME.messageStyle
    ),
    orbStyle: normalizeEnum(
      o["orbStyle"],
      ["ring", "pulse", "dot", "hidden"] as const,
      DEFAULT_PERSONA_UI_THEME.orbStyle
    ),
    background: normalizeEnum(
      o["background"],
      ["solid", "grid", "scanline", "gradient"] as const,
      DEFAULT_PERSONA_UI_THEME.background
    ),
    fontPair: normalizeEnum(o["fontPair"], FONT_PAIR_VALUES, DEFAULT_PERSONA_UI_THEME.fontPair),
    backgroundCss: sanitizeBackgroundCss(o["backgroundCss"]),
    inputStyle: normalizeEnum(o["inputStyle"], INPUT_STYLE_VALUES, DEFAULT_PERSONA_UI_THEME.inputStyle),
    avatarStyle: normalizeEnum(o["avatarStyle"], AVATAR_STYLE_VALUES, DEFAULT_PERSONA_UI_THEME.avatarStyle),
    avatarGlyph: sanitizeAvatarGlyph(o["avatarGlyph"]),
    toolCards: normalizeEnum(o["toolCards"], TOOL_CARDS_VALUES, DEFAULT_PERSONA_UI_THEME.toolCards),
    messageEntrance: normalizeEnum(o["messageEntrance"], MSG_ENTRANCE_VALUES, DEFAULT_PERSONA_UI_THEME.messageEntrance),
    headerStyle: normalizeEnum(o["headerStyle"], HEADER_STYLE_VALUES, DEFAULT_PERSONA_UI_THEME.headerStyle),
    panelLayout: normalizeEnum(o["panelLayout"], PANEL_LAYOUT_VALUES, DEFAULT_PERSONA_UI_THEME.panelLayout),
    inputDock: normalizeEnum(o["inputDock"], INPUT_DOCK_VALUES, DEFAULT_PERSONA_UI_THEME.inputDock),
  };
}

/** Shift hue on RGB for category harmonics (degrees). */
function rotateRgb(rgb: { r: number; g: number; b: number }, degrees: number): { r: number; g: number; b: number } {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  const d = max - min;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const nh = (((h + degrees) % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((nh / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (nh < 60) {
    r1 = c;
    g1 = x;
  } else if (nh < 120) {
    r1 = x;
    g1 = c;
  } else if (nh < 180) {
    g1 = c;
    b1 = x;
  } else if (nh < 240) {
    g1 = x;
    b1 = c;
  } else if (nh < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  return {
    r: Math.round((r1 + m) * 255),
    g: Math.round((g1 + m) * 255),
    b: Math.round((b1 + m) * 255),
  };
}

const CATEGORY_HUE_OFFSETS: Record<PersonaCategoryKey, number> = {
  shell: 0,
  file: 35,
  web: 75,
  memory: 120,
  vault: 155,
  code: 190,
  git: 225,
  markets: 260,
  vision: 295,
  docs: 330,
  orchestration: 15,
  context: 50,
  other: 90,
};

/** Algorithmic tool-category colors from accent when LLM omits categoryTint. */
export function deriveCategoryTintsFromTheme(theme: PersonaUiThemeV2): Record<PersonaCategoryKey, string> {
  const base = parseHexToRgb(theme.accent) ?? parseHexToRgb(DEFAULT_PERSONA_UI_THEME.accent)!;
  const out = {} as Record<PersonaCategoryKey, string>;
  for (const key of PERSONA_CATEGORY_KEYS) {
    const custom = theme.categoryTint?.[key];
    if (custom && parseHexToRgb(custom)) {
      out[key] = sanitizeHex(custom, theme.accent);
    } else {
      const rotated = rotateRgb(base, CATEGORY_HUE_OFFSETS[key]);
      const boosted = boostContrastOnBg(rotated, DARK_BG_FALLBACK, 3.2);
      out[key] = rgbToHex(boosted.r, boosted.g, boosted.b);
    }
  }
  return out;
}

export interface PersonaSemanticTokens {
  bg: string;
  text: string;
  textMuted: string;
  textDim: string;
  panel: string;
  border: string;
  assistant: string;
  userBg: string;
  codeBg: string;
  surface1: string;
  surface2: string;
  markdownH1: string;
  markdownH2: string;
  markdownLink: string;
  category: Record<PersonaCategoryKey, string>;
}

/** Derived semantic colors for web CSS variables (not model context). */
export function derivePersonaSemanticTokens(theme: PersonaUiThemeV2): PersonaSemanticTokens {
  const bgRgb = parseHexToRgb(theme.surfaceTint) ?? DARK_BG_FALLBACK;
  const bgDark = darkenPreservingHue(bgRgb, 2);
  const bg = rgbToHex(
    Math.max(2, bgDark.r - 2),
    Math.max(2, bgDark.g - 2),
    Math.max(2, bgDark.b - 2)
  );
  const bgForContrast = parseHexToRgb(bg)!;
  const textRgb = boostContrastOnBg({ r: 200, g: 215, b: 230 }, bgForContrast, 4.2);
  const mutedRgb = parseHexToRgb(theme.muted)!;
  const successRgb = parseHexToRgb(theme.success)!;
  const accentRgb = parseHexToRgb(theme.accent)!;
  const secondaryRgb = parseHexToRgb(theme.secondary)!;
  const panelRgb = {
    r: Math.min(96, bgRgb.r + 22),
    g: Math.min(104, bgRgb.g + 24),
    b: Math.min(112, bgRgb.b + 26),
  };
  const surf1Rgb = {
    r: Math.max(4, bgRgb.r + 6),
    g: Math.max(4, bgRgb.g + 8),
    b: Math.max(4, bgRgb.b + 10),
  };
  const surf2Rgb = {
    r: Math.min(72, bgRgb.r + 16),
    g: Math.min(80, bgRgb.g + 18),
    b: Math.min(88, bgRgb.b + 20),
  };
  const textDimRgb = boostContrastOnBg({ r: 96, g: 110, b: 128 }, bgForContrast, 2.8);
  return {
    bg,
    text: rgbToHex(textRgb.r, textRgb.g, textRgb.b),
    textMuted: theme.muted,
    textDim: rgbToHex(textDimRgb.r, textDimRgb.g, textDimRgb.b),
    panel: rgbToHex(panelRgb.r, panelRgb.g, panelRgb.b),
    surface1: `rgba(${surf1Rgb.r},${surf1Rgb.g},${surf1Rgb.b},0.82)`,
    surface2: `rgba(${surf2Rgb.r},${surf2Rgb.g},${surf2Rgb.b},0.9)`,
    border: `rgba(${rgbTriplet(accentRgb)},0.12)`,
    assistant: rgbToHex(successRgb.r, successRgb.g, successRgb.b),
    userBg: `rgba(${rgbTriplet(accentRgb)},0.18)`,
    codeBg: rgbToHex(
      Math.max(2, bgRgb.r + 6),
      Math.max(2, bgRgb.g + 8),
      Math.max(2, bgRgb.b + 10)
    ),
    markdownH1: theme.success,
    markdownH2: theme.secondary,
    markdownLink: theme.accent,
    category: deriveCategoryTintsFromTheme(theme),
  };
}

export interface PersonaCssVarMap {
  [key: string]: string;
}

/** Google Fonts URL for each font pair (empty string = no external load). */
export const FONT_PAIR_GOOGLE_URL: Record<PersonaUiFontPair, string> = {
  "system": "",
  "ibm-plex": "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:ital,wght@0,400;0,500;0,600;1,400&family=IBM+Plex+Sans:ital,wght@0,300;0,400;0,500;0,600;1,400&display=swap",
  "jetbrains": "https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&display=swap",
  "inter-cascadia": "https://fonts.googleapis.com/css2?family=Cascadia+Code:wght@400;600&family=Inter:wght@300;400;500;600&display=swap",
  "playfair": "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=Source+Sans+3:ital,wght@0,300;0,400;0,600;1,400&display=swap",
  "geist": "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600&family=Geist+Mono:wght@400;500;600&display=swap",
};

interface FontPairStacks { body: string; mono: string; heading: string }

function resolveFontStacks(pair: PersonaUiFontPair, typography: PersonaUiTypography): FontPairStacks {
  const sysMono = '"Consolas", "Cascadia Mono", "Courier New", monospace';
  const sysSans = '"Segoe UI", system-ui, -apple-system, sans-serif';
  const stacks: Record<PersonaUiFontPair, FontPairStacks> = {
    "system":         { body: sysSans,                                             mono: sysMono,                            heading: sysSans },
    "ibm-plex":       { body: '"IBM Plex Sans", system-ui, sans-serif',            mono: '"IBM Plex Mono", monospace',        heading: '"IBM Plex Sans", system-ui, sans-serif' },
    "jetbrains":      { body: '"JetBrains Mono", monospace',                       mono: '"JetBrains Mono", monospace',       heading: '"JetBrains Mono", monospace' },
    "inter-cascadia": { body: '"Inter", system-ui, sans-serif',                    mono: '"Cascadia Code", monospace',        heading: '"Inter", system-ui, sans-serif' },
    "playfair":       { body: '"Source Sans 3", "Source Sans Pro", system-ui, sans-serif', mono: sysMono,                   heading: '"Playfair Display", Georgia, serif' },
    "geist":          { body: '"Geist", system-ui, sans-serif',                    mono: '"Geist Mono", monospace',           heading: '"Geist", system-ui, sans-serif' },
  };
  const s = stacks[pair];
  const body = typography === "mono" ? s.mono : typography === "sans" ? s.body : s.body;
  return { body, mono: s.mono, heading: s.heading };
}

/** Flat map of CSS custom properties for :root (web client). */
export function themeToCssVars(theme: PersonaUiThemeV2): PersonaCssVarMap {
  const t = validateAndNormalizePersonaUiTheme(theme);
  const sem = derivePersonaSemanticTokens(t);
  const m = motionPresetToCssMultipliers(t.motion);
  const densityScale =
    t.density === "compact" ? 0.88 : t.density === "spacious" ? 1.12 : 1;
  const radiusPx = t.radius === "sharp" ? 2 : t.radius === "pill" ? 14 : 6;
  const fonts = resolveFontStacks(t.fontPair, t.typography);
  const fontMono = fonts.mono;
  const fontBody = fonts.body;

  const vars: PersonaCssVarMap = {
    "--lim-bg": sem.bg,
    "--lim-accent": t.accent,
    "--lim-secondary": t.secondary,
    "--lim-warn": t.warn,
    "--lim-danger": t.danger,
    "--lim-success": t.success,
    "--lim-muted": t.muted,
    "--lim-surface": t.surfaceTint,
    "--lim-text": sem.text,
    "--lim-text-muted": sem.textMuted,
    "--lim-panel": sem.panel,
    "--lim-border": sem.border,
    "--lim-assistant": sem.assistant,
    "--lim-user-bg": sem.userBg,
    "--lim-code-bg": sem.codeBg,
    "--lim-surface-1": sem.surface1,
    "--lim-surface-2": sem.surface2,
    "--lim-text-dim": sem.textDim,
    "--lim-markdown-h1": sem.markdownH1,
    "--lim-markdown-h2": sem.markdownH2,
    "--lim-markdown-link": sem.markdownLink,
    "--lim-accent-rgb": rgbTriplet(parseHexToRgb(t.accent)!),
    "--lim-secondary-rgb": rgbTriplet(parseHexToRgb(t.secondary)!),
    "--lim-warn-rgb": rgbTriplet(parseHexToRgb(t.warn)!),
    "--lim-danger-rgb": rgbTriplet(parseHexToRgb(t.danger)!),
    "--lim-success-rgb": rgbTriplet(parseHexToRgb(t.success)!),
    "--lim-muted-rgb": rgbTriplet(parseHexToRgb(t.muted)!),
    "--lim-surface-rgb": rgbTriplet(parseHexToRgb(t.surfaceTint)!),
    "--lim-density-scale": String(densityScale),
    "--lim-radius": `${radiusPx}px`,
    "--lim-font-body": fontBody,
    "--lim-font-mono": fontMono,
    "--lim-font-heading": fonts.heading,
    // Message entrance animation duration (used by injected keyframes)
    "--lim-msg-entrance-dur":
      t.messageEntrance === "fade" ? "220ms"
      : t.messageEntrance === "slide" ? "160ms"
      : t.messageEntrance === "typewriter" ? "280ms"
      : "0ms",
    "--lim-motion-orb-idle": `${(3.5 * m.orbIdle).toFixed(2)}s`,
    "--lim-motion-orb-spin": `${(0.65 * m.orbSpin).toFixed(2)}s`,
    "--lim-motion-orb-think": `${(2.2 * m.orbThink).toFixed(2)}s`,
    "--lim-motion-orb-approv": `${(0.7 * m.orbApprov).toFixed(2)}s`,
    "--lim-motion-blink": `${(1 * m.blink).toFixed(2)}s`,
  };
  for (const key of PERSONA_CATEGORY_KEYS) {
    vars[`--lim-cat-${key}`] = sem.category[key];
    const rgb = parseHexToRgb(sem.category[key]);
    if (rgb) vars[`--lim-cat-${key}-rgb`] = rgbTriplet(rgb);
  }
  return vars;
}

/** Heuristic shell/appearance selection when LLM theme generation fails or is disabled. */
export function derivePersonaShellHeuristics(profile: {
  speechStyle?: { formality?: string };
  tone?: { emotionalFlavor?: string; humorStyle?: string };
}): Pick<
  PersonaUiThemeV2,
  "shell" | "density" | "typography" | "messageStyle" | "orbStyle" | "background"
  | "fontPair" | "inputStyle" | "avatarStyle" | "toolCards" | "messageEntrance"
  | "headerStyle" | "panelLayout" | "inputDock"
> {
  const formality = (profile.speechStyle?.formality ?? "").toLowerCase();
  const flavor = (profile.tone?.emotionalFlavor ?? "").toLowerCase();
  const humor = (profile.tone?.humorStyle ?? "").toLowerCase();

  const combined = `${formality} ${flavor} ${humor}`;
  if (/tactical|military|commander|operative|noir|gritty|stark|cyberpunk|sci-fi|scifi|jarvis|hud/.test(combined)) {
    return {
      shell: "hud", density: "compact", typography: "mixed",
      messageStyle: "flat", orbStyle: "ring", background: "grid",
      fontPair: "inter-cascadia", inputStyle: "command", avatarStyle: "glyph",
      toolCards: "compact", messageEntrance: "fade",
      headerStyle: "bar", panelLayout: "both", inputDock: "bottom-bar",
    };
  }
  if (/coach|hype|energetic|bold|charismatic|motivat/.test(combined)) {
    return {
      shell: "hud", density: "comfortable", typography: "sans",
      messageStyle: "bubble", orbStyle: "pulse", background: "gradient",
      fontPair: "inter-cascadia", inputStyle: "default", avatarStyle: "orb",
      toolCards: "verbose", messageEntrance: "slide",
      headerStyle: "bar", panelLayout: "both", inputDock: "bottom-bar",
    };
  }
  if (/formal|academic|analyst|precise|dry/.test(formality + flavor)) {
    return {
      shell: "terminal", density: "compact", typography: "mono",
      messageStyle: "transcript", orbStyle: "dot", background: "scanline",
      fontPair: "jetbrains", inputStyle: "command", avatarStyle: "stripe",
      toolCards: "log", messageEntrance: "instant",
      headerStyle: "none", panelLayout: "none", inputDock: "bottom-bar",
    };
  }
  if (/warm|kind|mentor|gentle|supportive|empathetic/.test(flavor + humor)) {
    return {
      shell: "studio", density: "spacious", typography: "sans",
      messageStyle: "bubble", orbStyle: "pulse", background: "gradient",
      fontPair: "ibm-plex", inputStyle: "document", avatarStyle: "orb",
      toolCards: "compact", messageEntrance: "slide",
      headerStyle: "pill", panelLayout: "right", inputDock: "floating",
    };
  }
  if (/minimal|quiet|sparse|zen/.test(flavor)) {
    return {
      shell: "minimal", density: "comfortable", typography: "sans",
      messageStyle: "flat", orbStyle: "hidden", background: "solid",
      fontPair: "geist", inputStyle: "minimal", avatarStyle: "none",
      toolCards: "compact", messageEntrance: "fade",
      headerStyle: "none", panelLayout: "none", inputDock: "inline",
    };
  }
  if (/editorial|formal|eloquent|literary/.test(flavor + formality)) {
    return {
      shell: "studio", density: "spacious", typography: "sans",
      messageStyle: "transcript", orbStyle: "dot", background: "gradient",
      fontPair: "playfair", inputStyle: "document", avatarStyle: "stripe",
      toolCards: "compact", messageEntrance: "fade",
      headerStyle: "pill", panelLayout: "right", inputDock: "floating",
    };
  }
  return {
    shell: "hud", density: "comfortable", typography: "mixed",
    messageStyle: "bubble", orbStyle: "ring", background: "grid",
    fontPair: "system", inputStyle: "default", avatarStyle: "orb",
    toolCards: "verbose", messageEntrance: "instant",
    headerStyle: "bar", panelLayout: "both", inputDock: "bottom-bar",
  };
}

function hashPersonaPaletteSeed(text: string): number {
  let h = 2166136261;
  const s = text.toLowerCase().trim();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

/** Stable per-persona colors when LLM theme is off or fails — avoids identical cyan HUD for everyone. */
export function deriveDeterministicPersonaPalette(seedText: string): Pick<
  PersonaUiThemeV2,
  "accent" | "secondary" | "warn" | "danger" | "success" | "muted" | "surfaceTint"
> {
  const h = hashPersonaPaletteSeed(seedText);
  const hue = (h % 360) / 360;
  const accent = hslToRgb(hue, 0.72, 0.62);
  const secondary = hslToRgb((hue + 0.38) % 1, 0.65, 0.58);
  const warn = hslToRgb((hue + 0.12) % 1, 0.75, 0.58);
  const success = hslToRgb((hue + 0.55) % 1, 0.7, 0.52);
  const danger = hslToRgb((hue + 0.02) % 1, 0.78, 0.48);
  const muted = hslToRgb(hue, 0.15, 0.52);
  const surface = hslToRgb(hue, 0.35, 0.08);
  return {
    accent: rgbToHex(accent.r, accent.g, accent.b),
    secondary: rgbToHex(secondary.r, secondary.g, secondary.b),
    warn: rgbToHex(warn.r, warn.g, warn.b),
    danger: rgbToHex(danger.r, danger.g, danger.b),
    success: rgbToHex(success.r, success.g, success.b),
    muted: rgbToHex(muted.r, muted.g, muted.b),
    surfaceTint: rgbToHex(surface.r, surface.g, surface.b),
  };
}

/** Map hex theme to nearest Ink named color for terminal chrome. */
export function mapPersonaUiThemeToInk(theme: PersonaUiThemeV2): Record<
  "accent" | "secondary" | "warn" | "danger" | "success" | "muted",
  string
> & { shell: PersonaUiShell } {
  const pick = (hex: string) => {
    const rgb = parseHexToRgb(hex);
    if (!rgb) return "cyan";
    let best = INK_CANDIDATES[0]!;
    let bestD = Infinity;
    for (const c of INK_CANDIDATES) {
      const d = (rgb.r - c.rgb[0]) ** 2 + (rgb.g - c.rgb[1]) ** 2 + (rgb.b - c.rgb[2]) ** 2;
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
    shell: theme.shell,
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

export function shellDefaultShowSidePanels(shell: PersonaUiShell): boolean {
  return shell === "hud" || shell === "studio";
}

/** Which side panels to render for the active theme (respects panelLayout). */
export function resolvePersonaPanelSides(theme: PersonaUiThemeV2 | null | undefined): {
  left: boolean;
  right: boolean;
} {
  const t = theme ? validateAndNormalizePersonaUiTheme(theme) : DEFAULT_PERSONA_UI_THEME;
  if (t.panelLayout === "none") return { left: false, right: false };
  if (t.panelLayout === "left") return { left: true, right: false };
  if (t.panelLayout === "right") return { left: false, right: true };
  return { left: true, right: true };
}

/** Whether any side panel chrome should show at this viewport width. */
export function shouldShowPersonaSidePanels(
  theme: PersonaUiThemeV2 | null | undefined,
  windowWidth: number
): boolean {
  const t = theme ? validateAndNormalizePersonaUiTheme(theme) : DEFAULT_PERSONA_UI_THEME;
  if (t.panelLayout === "none") return false;
  if (!shellDefaultShowSidePanels(t.shell)) return false;
  return windowWidth >= 900;
}

export function shellRootClassName(shell: PersonaUiShell): string {
  return `persona-shell persona-shell--${shell}`;
}
