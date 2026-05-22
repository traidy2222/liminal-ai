import {
  migratePersonaUiTheme,
  themeToCssVars,
  FONT_PAIR_GOOGLE_URL,
  type PersonaUiThemeV2,
} from "@liminal/core/persona-ui-theme";
import { motionPresetToCssMultipliers } from "@liminal/core/persona-ui-theme";

/** Injects (or updates) a Google Fonts <link> for the chosen font pair. */
function applyFontPairLink(url: string): void {
  const LINK_ID = "persona-font-pair-link";
  let el = document.getElementById(LINK_ID) as HTMLLinkElement | null;
  if (!url) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement("link") as HTMLLinkElement;
    el.id = LINK_ID;
    el.rel = "stylesheet";
    document.head.appendChild(el);
  }
  if (el.href !== url) el.href = url;
}

/**
 * Sets :root CSS variables, data-* shell attributes, font pair link, and motion keyframes.
 */
export function applyPersonaDocumentTheme(theme: PersonaUiThemeV2 | null): void {
  const t = migratePersonaUiTheme(theme);
  const root = document.documentElement;
  const vars = themeToCssVars(t);

  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  // Shell / layout data attributes
  root.dataset.personaShell = t.shell;
  root.dataset.personaDensity = t.density;
  root.dataset.personaRadius = t.radius;
  root.dataset.personaTypography = t.typography;
  root.dataset.personaMessageStyle = t.messageStyle;
  root.dataset.personaOrbStyle = t.orbStyle;
  root.dataset.personaBackground = t.background;
  // Extended appearance attributes
  root.dataset.personaFontPair = t.fontPair;
  root.dataset.personaInputStyle = t.inputStyle;
  root.dataset.personaAvatarStyle = t.avatarStyle;
  root.dataset.personaToolCards = t.toolCards;
  root.dataset.personaMessageEntrance = t.messageEntrance;

  // Google Fonts injection
  applyFontPairLink(FONT_PAIR_GOOGLE_URL[t.fontPair]);

  const m = motionPresetToCssMultipliers(t.motion);
  const ar = vars["--lim-accent-rgb"] ?? "0, 212, 255";
  const wr = vars["--lim-warn-rgb"] ?? "255, 179, 71";
  const sr = vars["--lim-secondary-rgb"] ?? "255, 68, 136";
  const entranceDur = vars["--lim-msg-entrance-dur"] ?? "0ms";

  const idleDur = vars["--lim-motion-orb-idle"] ?? `${(3.5 * m.orbIdle).toFixed(2)}s`;
  const spinDur = vars["--lim-motion-orb-spin"] ?? `${(0.65 * m.orbSpin).toFixed(2)}s`;
  const thinkDur = vars["--lim-motion-orb-think"] ?? `${(2.2 * m.orbThink).toFixed(2)}s`;
  const approvDur = vars["--lim-motion-orb-approv"] ?? `${(0.7 * m.orbApprov).toFixed(2)}s`;
  const blinkDur = vars["--lim-motion-blink"] ?? `${(1 * m.blink).toFixed(2)}s`;

  let el = document.getElementById("persona-ui-keyframes");
  if (!el) {
    el = document.createElement("style");
    el.id = "persona-ui-keyframes";
    document.head.appendChild(el);
  }
  el.textContent = `
@keyframes blink         { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes orb-idle      { 0%,100%{opacity:.38;box-shadow:0 0 8px rgba(${ar},.28)} 50%{opacity:.72;box-shadow:0 0 20px rgba(${ar},.6)} }
@keyframes orb-think     { 0%,100%{box-shadow:0 0 8px rgba(${wr},.4)} 50%{box-shadow:0 0 24px rgba(${wr},.9),0 0 44px rgba(${wr},.3)} }
@keyframes orb-spin      { to{transform:rotate(360deg)} }
@keyframes orb-approv    { 0%,100%{box-shadow:0 0 10px rgba(${sr},.5)} 50%{box-shadow:0 0 28px rgba(${sr},1),0 0 54px rgba(${sr},.4)} }
@keyframes data-pulse    { 0%,100%{opacity:.55} 50%{opacity:1} }
@keyframes hud-in        { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
@keyframes msg-fade      { from{opacity:0} to{opacity:1} }
@keyframes msg-slide     { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
@keyframes msg-typewriter{ from{opacity:0;clip-path:inset(0 100% 0 0)} to{opacity:1;clip-path:inset(0 0% 0 0)} }
.blink-caret { animation: blink ${blinkDur} step-end infinite !important; }
.orb-idle-anim { animation: orb-idle ${idleDur} ease-in-out infinite !important; }
.orb-spin-anim { animation: orb-spin ${spinDur} linear infinite !important; }
.orb-think-anim { animation: orb-think ${thinkDur} ease-in-out infinite !important; }
.orb-approv-anim { animation: orb-approv ${approvDur} ease-in-out infinite !important; }
.persona-shell--terminal { --lim-font-body: var(--lim-font-mono); }
.persona-shell--studio .persona-panel { border-radius: var(--lim-radius); }
.persona-shell--minimal [data-persona-side-panel] { display: none !important; }
.msg-entrance-fade       { animation: msg-fade ${entranceDur} ease both; }
.msg-entrance-slide      { animation: msg-slide ${entranceDur} cubic-bezier(.22,.68,0,1.2) both; }
.msg-entrance-typewriter { animation: msg-typewriter ${entranceDur} steps(40,end) both; }
/* ── .lim-md — markdown content themed via CSS vars ─────────────────── */
.lim-md h1 { color: var(--lim-markdown-h1); border-bottom-color: rgba(var(--lim-success-rgb),.15); }
.lim-md h2 { color: var(--lim-markdown-h2); }
.lim-md h3 { color: var(--lim-secondary); }
.lim-md h4 { color: var(--lim-warn); }
.lim-md a  { color: var(--lim-markdown-link); border-bottom-color: rgba(var(--lim-accent-rgb),.3); }
.lim-md code { background: var(--lim-surface-1); color: var(--lim-success); border-color: rgba(var(--lim-accent-rgb),.12); }
.lim-md pre  { background: var(--lim-code-bg); }
.lim-md blockquote { background: var(--lim-surface-1); border-left-color: rgba(var(--lim-accent-rgb),.25); color: var(--lim-text-dim); }
.lim-md table  { background: var(--lim-surface-1); }
.lim-md th     { background: var(--lim-surface-2); color: var(--lim-text-muted); border-color: rgba(var(--lim-accent-rgb),.1); }
.lim-md td     { color: var(--lim-text-dim); border-color: rgba(var(--lim-accent-rgb),.07); }
.lim-md hr     { background: linear-gradient(90deg, transparent, rgba(var(--lim-accent-rgb),.15), rgba(var(--lim-success-rgb),.33), rgba(var(--lim-accent-rgb),.15), transparent); }
.lim-md img    { border-color: rgba(var(--lim-accent-rgb),.1); border-radius: var(--lim-radius); }
.lim-md figcaption, .lim-md .img-caption { color: var(--lim-text-dim); }
`;
}
