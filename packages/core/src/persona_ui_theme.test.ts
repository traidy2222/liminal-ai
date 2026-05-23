import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAndNormalizePersonaUiTheme,
  migratePersonaUiTheme,
  parseHexToRgb,
  contrastRatio,
  DEFAULT_PERSONA_UI_THEME,
  deriveCategoryTintsFromTheme,
  derivePersonaSemanticTokens,
  deriveDeterministicPersonaPalette,
  resolvePersonaPanelSides,
  shouldShowPersonaSidePanels,
  themeToCssVars,
} from "./persona_ui_theme.js";

test("parseHexToRgb accepts 6-digit hex", () => {
  assert.deepEqual(parseHexToRgb("#00d4ff"), { r: 0, g: 212, b: 255 });
  assert.deepEqual(parseHexToRgb("020408"), { r: 2, g: 4, b: 8 });
});

test("validateAndNormalizePersonaUiTheme fills v2 defaults and boosts low contrast", () => {
  const t = validateAndNormalizePersonaUiTheme(
    {
      accent: "#001122",
      secondary: "#110011",
      displayLabel: "x".repeat(40),
      motion: "snappy",
      shell: "terminal",
    },
    "Ada"
  );
  assert.equal(t.v, 2);
  assert.equal(t.displayLabel.length, 24);
  assert.equal(t.shell, "terminal");
  assert.equal(t.motion, "snappy");
  const bg = parseHexToRgb(t.surfaceTint)!;
  const ar = parseHexToRgb(t.accent)!;
  assert.ok(contrastRatio(ar, bg) >= 3.5);
});

test("migratePersonaUiTheme upgrades v1 to v2", () => {
  const t = migratePersonaUiTheme({
    v: 1,
    accent: "#00d4ff",
    secondary: "#ff4488",
    warn: "#ffb347",
    danger: "#ff2244",
    success: "#00ff88",
    muted: "#778899",
    surfaceTint: "#0a1018",
    displayLabel: "Test",
    motion: "default",
  });
  assert.equal(t.v, 2);
  assert.equal(t.shell, "hud");
  assert.equal(t.typography, "mixed");
});

test("invalid shell falls back to hud", () => {
  const t = validateAndNormalizePersonaUiTheme({ shell: "weird" }, "Pat");
  assert.equal(t.shell, "hud");
});

test("deriveCategoryTintsFromTheme is stable per accent", () => {
  const t = validateAndNormalizePersonaUiTheme({}, "X");
  const a = deriveCategoryTintsFromTheme(t);
  const b = deriveCategoryTintsFromTheme(t);
  assert.equal(a.file, b.file);
  assert.ok(parseHexToRgb(a.shell));
});

test("themeToCssVars includes semantic and motion keys", () => {
  const vars = themeToCssVars(DEFAULT_PERSONA_UI_THEME);
  assert.ok(vars["--lim-text"]);
  assert.ok(vars["--lim-motion-orb-idle"]);
  assert.ok(vars["--lim-cat-file"]);
});

test("derivePersonaSemanticTokens provides assistant color", () => {
  const sem = derivePersonaSemanticTokens(DEFAULT_PERSONA_UI_THEME);
  assert.ok(parseHexToRgb(sem.assistant));
});

test("DEFAULT theme parses", () => {
  assert.ok(parseHexToRgb(DEFAULT_PERSONA_UI_THEME.accent));
});

test("deriveDeterministicPersonaPalette differs by seed", () => {
  const a = deriveDeterministicPersonaPalette("Tars:tactical commander");
  const b = deriveDeterministicPersonaPalette("Mira:warm mentor");
  assert.notEqual(a.accent, b.accent);
  assert.notEqual(a.surfaceTint, b.surfaceTint);
});

test("resolvePersonaPanelSides respects panelLayout", () => {
  const t = validateAndNormalizePersonaUiTheme({ panelLayout: "right" }, "X");
  assert.deepEqual(resolvePersonaPanelSides(t), { left: false, right: true });
  const none = validateAndNormalizePersonaUiTheme({ panelLayout: "none" }, "X");
  assert.deepEqual(resolvePersonaPanelSides(none), { left: false, right: false });
});

test("shouldShowPersonaSidePanels hides when panelLayout none", () => {
  const t = validateAndNormalizePersonaUiTheme({ panelLayout: "none", shell: "hud" }, "X");
  assert.equal(shouldShowPersonaSidePanels(t, 1200), false);
});
