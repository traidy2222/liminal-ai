/** Matches Liminal web UI CSS variables (packages/web/client/App.tsx). */
export const LIMINAL_THEME = {
  bg: "#020408",
  bgElevated: "#0a1018",
  bgPanel: "#010305",
  accent: "#00d4ff",
  secondary: "#ff4488",
  success: "#00ff88",
  warn: "#ffb347",
  danger: "#ff2244",
  text: "#e8f0f8",
  textMuted: "#8899aa",
  textDim: "#556677",
  border: "rgba(0, 212, 255, 0.22)",
  gridLine: "rgba(0, 212, 255, 0.06)",
  fontSans:
    'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif',
  fontMono:
    '"JetBrains Mono", "Cascadia Code", "Fira Code", Consolas, monospace',
} as const;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
} as const;

export const BRAND = {
  name: "Liminal",
  tagline: "Local agent harness for coding, research & automation",
  vendor: "Vireon Dynamics",
  site: "vireondynamics.com/liminal",
  docs: "docs.vireondynamics.com/liminal",
} as const;
