import { Easing } from "remotion";

/**
 * Cinematic design system for the AAA desktop reels.
 *
 * Palette bridges the desktop app's emerald persona theme (the real captures)
 * with the web brand cyan, on a near-black green-tinted base.
 */
export const CINEMA = {
  bg: "#020604",
  bgDeep: "#010302",
  panel: "#06120c",
  panelBorder: "rgba(43, 217, 124, 0.22)",
  emerald: "#2bd97c",
  emeraldBright: "#52f29a",
  cyan: "#00d4ff",
  violet: "#8a7bff",
  amber: "#ffc466",
  danger: "#ff5566",
  text: "#eef7f1",
  textMuted: "#9db4a8",
  textDim: "#5d7468",
  fontSans:
    '"Segoe UI Variable Display", "Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", sans-serif',
  fontMono:
    '"Cascadia Code", "JetBrains Mono", "Fira Code", Consolas, monospace',
} as const;

export const CINEMA_VIDEO = {
  width: 1920,
  height: 1080,
  fps: 60,
} as const;

/** Expo-style ease-out — the backbone of every entrance. */
export const easeOutExpo = Easing.bezier(0.16, 1, 0.3, 1);
/** Gentle ease for camera drifts. */
export const easeInOutSine = Easing.bezier(0.37, 0, 0.63, 1);

/**
 * Sine wave that completes `cycles` full periods over `durationInFrames`,
 * so frame 0 and the final frame match exactly — seamless loops.
 */
export function loopSin(
  frame: number,
  durationInFrames: number,
  cycles: number,
  phase = 0
): number {
  return Math.sin((frame / durationInFrames) * Math.PI * 2 * cycles + phase);
}

/** Clamped 0→1 progress between two frames with expo-out easing. */
export function ramp(frame: number, from: number, to: number): number {
  if (frame <= from) return 0;
  if (frame >= to) return 1;
  return easeOutExpo((frame - from) / (to - from));
}

/** Film-grain texture as an inline SVG data URI (feTurbulence). */
export const GRAIN_URI = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.55'/></svg>`
)}")`;
