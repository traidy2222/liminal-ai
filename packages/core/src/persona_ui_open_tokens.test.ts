import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAndNormalizePersonaUiTheme,
  resolveDensityScale,
  resolveRadiusPx,
  resolveMotionScale,
  resolveTypeScale,
  gradientToCss,
  themeToCssVars,
  DEFAULT_PERSONA_UI_THEME,
  PERSONA_OPEN_TOKEN_RANGES,
} from "./persona_ui_theme.js";
import {
  sanitizePersonaUiCopy,
  DEFAULT_PERSONA_UI_COPY,
  isDefaultPersonaUiCopy,
} from "./persona_ui_copy.js";
import { deriveLayoutFromTheme, validatePersonaLayout } from "./persona_ui_layout.js";

test("open tokens clamp into range and override the enum", () => {
  const t = validateAndNormalizePersonaUiTheme({
    ...DEFAULT_PERSONA_UI_THEME,
    density: "compact",
    densityScale: 5, // out of range → clamped to max
    radiusPx: -10, // → clamped to 0
    motionScale: 0.1, // → clamped to floor
    typeScale: 1.1,
  });
  assert.equal(t.densityScale, PERSONA_OPEN_TOKEN_RANGES.densityScale[1]);
  assert.equal(t.radiusPx, 0);
  assert.equal(t.motionScale, PERSONA_OPEN_TOKEN_RANGES.motionScale[0]);
  // resolver prefers the open token over the enum-derived value
  assert.equal(resolveDensityScale(t), PERSONA_OPEN_TOKEN_RANGES.densityScale[1]);
  assert.equal(resolveRadiusPx(t), 0);
  assert.equal(resolveTypeScale(t), 1.1);
  assert.equal(resolveMotionScale(t), PERSONA_OPEN_TOKEN_RANGES.motionScale[0]);
});

test("resolvers fall back to enum when open tokens absent", () => {
  const t = validateAndNormalizePersonaUiTheme({ ...DEFAULT_PERSONA_UI_THEME, density: "spacious", radius: "pill" });
  assert.equal(t.densityScale, undefined);
  assert.equal(resolveDensityScale(t), 1.12);
  assert.equal(resolveRadiusPx(t), 14);
  assert.equal(resolveMotionScale(t), 1);
});

test("structured gradient is validated, sorted, and renders to CSS", () => {
  const t = validateAndNormalizePersonaUiTheme({
    ...DEFAULT_PERSONA_UI_THEME,
    gradient: {
      kind: "linear",
      angle: 135,
      stops: [
        { color: "#180a18", at: 1 },
        { color: "#0a0a18", at: 0 },
        { color: "notacolor", at: 0.5 }, // dropped
      ],
    },
  });
  assert.ok(t.gradient);
  assert.equal(t.gradient!.stops.length, 2);
  assert.equal(t.gradient!.stops[0]!.at, 0); // sorted ascending
  const css = gradientToCss(t.gradient!);
  assert.match(css, /^linear-gradient\(135deg,/);
});

test("gradient with <2 valid stops is rejected", () => {
  const t = validateAndNormalizePersonaUiTheme({
    ...DEFAULT_PERSONA_UI_THEME,
    gradient: { kind: "linear", stops: [{ color: "#fff", at: 0 }] },
  });
  assert.equal(t.gradient, undefined);
});

test("themeToCssVars emits open-token vars", () => {
  const vars = themeToCssVars(
    validateAndNormalizePersonaUiTheme({ ...DEFAULT_PERSONA_UI_THEME, typeScale: 1.2, glowIntensity: 0.8 })
  );
  assert.equal(vars["--lim-type-scale"], "1.2");
  assert.equal(vars["--lim-glow"], "0.8");
});

test("persona ui copy sanitizes, clamps, and strips markup", () => {
  const copy = sanitizePersonaUiCopy({
    composerPlaceholder: "State your query, operative. <script>",
    sendLabel: "Transmit this very long label that exceeds the cap entirely",
    greeting: "ignored unknown field",
  });
  assert.ok(!copy.composerPlaceholder.includes("<"));
  assert.ok(copy.sendLabel.length <= 18);
  assert.equal(copy.emptyTitle, DEFAULT_PERSONA_UI_COPY.emptyTitle); // omitted → default
  assert.equal(copy.v, 1);
});

test("empty copy input yields defaults", () => {
  assert.ok(isDefaultPersonaUiCopy(sanitizePersonaUiCopy({})));
  assert.ok(isDefaultPersonaUiCopy(sanitizePersonaUiCopy(null)));
});

test("layout derives from theme and keeps composer present", () => {
  const minimal = deriveLayoutFromTheme({ ...DEFAULT_PERSONA_UI_THEME, shell: "minimal", headerStyle: "none", panelLayout: "none", inputDock: "inline" });
  assert.equal(minimal.header.present, false);
  assert.equal(minimal.leftPanel, false);
  assert.equal(minimal.composer.dock, "inline");
  assert.ok(minimal.transcriptMaxWidth > 0); // minimal caps width

  const hud = deriveLayoutFromTheme({ ...DEFAULT_PERSONA_UI_THEME, shell: "hud" });
  assert.equal(hud.header.present, true);
  assert.equal(hud.transcriptMaxWidth, 0); // hud fills
});

test("layout validation falls back to seed and clamps width", () => {
  const spec = validatePersonaLayout(
    { transcriptMaxWidth: 99999, composer: { dock: "bogus" }, header: { present: false } },
    DEFAULT_PERSONA_UI_THEME
  );
  assert.equal(spec.transcriptMaxWidth, 1200); // clamped
  assert.equal(spec.composer.dock, "bottom-bar"); // bogus → seed default
  assert.equal(spec.header.present, false); // honored boolean override
});
