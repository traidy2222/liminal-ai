import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAndNormalizePersonaUiTheme,
  parseHexToRgb,
  contrastRatio,
  DEFAULT_PERSONA_UI_THEME,
} from "./persona_ui_theme.js";

test("parseHexToRgb accepts 6-digit hex", () => {
  assert.deepEqual(parseHexToRgb("#00d4ff"), { r: 0, g: 212, b: 255 });
  assert.deepEqual(parseHexToRgb("020408"), { r: 2, g: 4, b: 8 });
});

test("validateAndNormalizePersonaUiTheme fills defaults and boosts low contrast", () => {
  const t = validateAndNormalizePersonaUiTheme(
    {
      accent: "#001122",
      secondary: "#110011",
      displayLabel: "x".repeat(40),
      motion: "snappy",
    },
    "Ada"
  );
  assert.equal(t.v, 1);
  assert.equal(t.displayLabel.length, 24);
  const bg = parseHexToRgb("#020408")!;
  const ar = parseHexToRgb(t.accent)!;
  assert.ok(contrastRatio(ar, bg) >= 3.8);
  assert.equal(t.motion, "snappy");
});

test("invalid motion falls back to default", () => {
  const t = validateAndNormalizePersonaUiTheme({ motion: "weird" }, "Pat");
  assert.equal(t.motion, "default");
});

test("DEFAULT theme parses", () => {
  assert.ok(parseHexToRgb(DEFAULT_PERSONA_UI_THEME.accent));
});
