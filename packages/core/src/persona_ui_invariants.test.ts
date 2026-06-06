import test from "node:test";
import assert from "node:assert/strict";
import {
  lintPersonaUi,
  repairPersonaUi,
  isPersonaUiConformant,
  PERSONA_UI_INVARIANTS,
} from "./persona_ui_invariants.js";
import {
  DEFAULT_PERSONA_UI_THEME,
  validateAndNormalizePersonaUiTheme,
  parseHexToRgb,
  contrastRatio,
  type PersonaUiThemeV2,
} from "./persona_ui_theme.js";

test("default theme is fully conformant", () => {
  assert.deepEqual(lintPersonaUi(DEFAULT_PERSONA_UI_THEME), []);
  assert.equal(isPersonaUiConformant(DEFAULT_PERSONA_UI_THEME), true);
});

test("flags danger/success that are perceptually indistinct", () => {
  // Two near-identical greens for both danger and success.
  const theme: PersonaUiThemeV2 = {
    ...DEFAULT_PERSONA_UI_THEME,
    danger: "#00ff88",
    success: "#00ff8a",
  };
  const violations = lintPersonaUi(theme);
  assert.ok(
    violations.some((v) => v.id === "semantics.danger_success_distinct"),
    "expected danger/success distinctness violation"
  );
});

test("flags a theme that renders no identity anchor", () => {
  // Header hidden (so the label is never shown), no orb, no avatar.
  const hidden: PersonaUiThemeV2 = {
    ...DEFAULT_PERSONA_UI_THEME,
    orbStyle: "hidden",
    avatarStyle: "none",
    headerStyle: "none",
  };
  assert.ok(
    lintPersonaUi(hidden).some((v) => v.id === "identity.anchor_present"),
    "expected identity-anchor violation when nothing is rendered"
  );

  // Any single anchor present clears it.
  assert.equal(
    isPersonaUiConformant({ ...hidden, orbStyle: "ring" }),
    true,
    "a visible orb is a sufficient anchor"
  );
  assert.equal(
    isPersonaUiConformant({ ...hidden, headerStyle: "bar" }),
    true,
    "a visible header (showing the label) is a sufficient anchor"
  );
});

test("repair makes a broken theme conformant and reports repairs", () => {
  const broken: PersonaUiThemeV2 = {
    ...DEFAULT_PERSONA_UI_THEME,
    danger: "#00ff88",
    success: "#00ff8a",
  };
  const { theme, repairs } = repairPersonaUi(broken);
  assert.deepEqual(lintPersonaUi(theme), [], "repaired theme should be conformant");
  assert.ok(repairs.length > 0, "expected at least one repair note");
  assert.notEqual(theme.success, broken.success, "success should have been adjusted");
});

test("repair preserves persona intent where it is already safe", () => {
  // A perfectly fine vivid magenta persona should pass through unchanged.
  const fine = validateAndNormalizePersonaUiTheme({
    ...DEFAULT_PERSONA_UI_THEME,
    accent: "#ff4488",
    surfaceTint: "#100208",
  });
  const { theme, repairs } = repairPersonaUi(fine);
  assert.deepEqual(repairs, []);
  assert.equal(theme.accent, fine.accent);
});

test("repaired contrast actually clears the configured floor", () => {
  const dim: PersonaUiThemeV2 = validateAndNormalizePersonaUiTheme({
    ...DEFAULT_PERSONA_UI_THEME,
    success: "#020a06",
    surfaceTint: "#020604",
  });
  const { theme } = repairPersonaUi(dim);
  const fg = parseHexToRgb(theme.success)!;
  const bg = parseHexToRgb(theme.surfaceTint)!;
  assert.ok(
    contrastRatio(fg, bg) >= PERSONA_UI_INVARIANTS.minLargeContrast,
    "success should meet the large-text contrast floor after repair"
  );
});
