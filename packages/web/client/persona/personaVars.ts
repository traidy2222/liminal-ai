/** Semantic CSS variables (set on :root by applyPersonaDocumentTheme). */
export const LIM = {
  bg: "var(--lim-bg, #020408)",
  accent: "var(--lim-accent, #00d4ff)",
  secondary: "var(--lim-secondary, #ff4488)",
  warn: "var(--lim-warn, #ffb347)",
  danger: "var(--lim-danger, #ff2244)",
  success: "var(--lim-success, #00ff88)",
  muted: "var(--lim-muted, #778899)",
  surface: "var(--lim-surface, #0a1018)",
  text: "var(--lim-text, #c8d4e0)",
  textMuted: "var(--lim-text-muted, #778899)",
  panel: "var(--lim-panel, #0e141c)",
  assistant: "var(--lim-assistant, #00ff88)",
  userBg: "var(--lim-user-bg, rgba(0,30,55,0.4))",
  codeBg: "var(--lim-code-bg, #030810)",
  surface1: "var(--lim-surface-1, rgba(10,14,22,0.82))",
  surface2: "var(--lim-surface-2, rgba(16,22,32,0.9))",
  textDim: "var(--lim-text-dim, #667788)",
  markdownH1: "var(--lim-markdown-h1, #7cf5a9)",
  markdownH2: "var(--lim-markdown-h2, #00d4ff)",
  markdownLink: "var(--lim-markdown-link, #00d4ff)",
  accentRgb: "var(--lim-accent-rgb, 0, 212, 255)",
  secondaryRgb: "var(--lim-secondary-rgb, 255, 68, 136)",
  warnRgb: "var(--lim-warn-rgb, 255, 179, 71)",
  dangerRgb: "var(--lim-danger-rgb, 255, 34, 68)",
  successRgb: "var(--lim-success-rgb, 0, 255, 136)",
  mutedRgb: "var(--lim-muted-rgb, 119, 136, 153)",
  radius: "var(--lim-radius, 6px)",
  fontBody: "var(--lim-font-body, system-ui, sans-serif)",
  fontMono: "var(--lim-font-mono, Consolas, monospace)",
  motionOrbIdle: "var(--lim-motion-orb-idle, 3.5s)",
  motionOrbSpin: "var(--lim-motion-orb-spin, 0.65s)",
  motionOrbThink: "var(--lim-motion-orb-think, 2.2s)",
  motionOrbApprov: "var(--lim-motion-orb-approv, 0.7s)",
} as const;

export function categoryColor(key: string): string {
  return `var(--lim-cat-${key}, var(--lim-accent))`;
}

export function categoryColorRgb(key: string): string {
  return `var(--lim-cat-${key}-rgb, var(--lim-accent-rgb))`;
}
