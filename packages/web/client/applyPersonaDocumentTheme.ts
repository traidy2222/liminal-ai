import {
  motionPresetToCssMultipliers,
  parseHexToRgb,
  validateAndNormalizePersonaUiTheme,
  type PersonaUiMotionPreset,
  type PersonaUiThemeV1,
} from "@liminal/core/persona-ui-theme";

const BG = "#020408";

function rgbTriplet(hex: string): string {
  if (typeof hex !== "string" || !hex.trim()) return "0, 212, 255";
  const rgb = parseHexToRgb(hex);
  if (!rgb) return "0, 212, 255";
  return `${rgb.r}, ${rgb.g}, ${rgb.b}`;
}

/**
 * Sets :root CSS variables and motion keyframes from a normalized persona theme.
 * Always runs {@link validateAndNormalizePersonaUiTheme} so partial/corrupt JSON
 * from the server or disk cannot crash the client (truthy `{}` used to skip
 * defaults and throw in `rgbTriplet`).
 */
export function applyPersonaDocumentTheme(theme: PersonaUiThemeV1 | null): void {
  const t = validateAndNormalizePersonaUiTheme(theme);
  const motion: PersonaUiMotionPreset = t.motion ?? "default";
  const m = motionPresetToCssMultipliers(motion);
  const root = document.documentElement;
  root.style.setProperty("--lim-bg", BG);
  root.style.setProperty("--lim-accent", t.accent);
  root.style.setProperty("--lim-secondary", t.secondary);
  root.style.setProperty("--lim-warn", t.warn);
  root.style.setProperty("--lim-danger", t.danger);
  root.style.setProperty("--lim-success", t.success);
  root.style.setProperty("--lim-muted", t.muted);
  root.style.setProperty("--lim-surface", t.surfaceTint);
  root.style.setProperty("--lim-accent-rgb", rgbTriplet(t.accent));
  root.style.setProperty("--lim-secondary-rgb", rgbTriplet(t.secondary));
  root.style.setProperty("--lim-warn-rgb", rgbTriplet(t.warn));
  root.style.setProperty("--lim-danger-rgb", rgbTriplet(t.danger));
  root.style.setProperty("--lim-success-rgb", rgbTriplet(t.success));

  const idleDur = (3.5 * m.orbIdle).toFixed(2);
  const spinDur = (0.65 * m.orbSpin).toFixed(2);
  const thinkDur = (2.2 * m.orbThink).toFixed(2);
  const approvDur = (0.7 * m.orbApprov).toFixed(2);
  const blinkDur = (1 * m.blink).toFixed(2);

  const ar = rgbTriplet(t.accent);
  const wr = rgbTriplet(t.warn);
  const sr = rgbTriplet(t.secondary);

  let el = document.getElementById("persona-ui-keyframes");
  if (!el) {
    el = document.createElement("style");
    el.id = "persona-ui-keyframes";
    document.head.appendChild(el);
  }
  el.textContent = `
@keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes orb-idle   { 0%,100%{opacity:.38;box-shadow:0 0 8px rgba(${ar},.28)} 50%{opacity:.72;box-shadow:0 0 20px rgba(${ar},.6)} }
@keyframes orb-think  { 0%,100%{box-shadow:0 0 8px rgba(${wr},.4)} 50%{box-shadow:0 0 24px rgba(${wr},.9),0 0 44px rgba(${wr},.3)} }
@keyframes orb-spin   { to{transform:rotate(360deg)} }
@keyframes orb-approv { 0%,100%{box-shadow:0 0 10px rgba(${sr},.5)} 50%{box-shadow:0 0 28px rgba(${sr},1),0 0 54px rgba(${sr},.4)} }
@keyframes data-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes hud-in     { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
.blink-caret { animation: blink ${blinkDur}s step-end infinite !important; }
.orb-idle-anim { animation: orb-idle ${idleDur}s ease-in-out infinite !important; }
.orb-spin-anim { animation: orb-spin ${spinDur}s linear infinite !important; }
.orb-think-anim { animation: orb-think ${thinkDur}s ease-in-out infinite !important; }
.orb-approv-anim { animation: orb-approv ${approvDur}s ease-in-out infinite !important; }
`;
}
