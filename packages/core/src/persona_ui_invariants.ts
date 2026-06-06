/**
 * Persona UI invariants — the "constitution" for persona-driven restyling.
 *
 * Persona generation is moving from a closed enum vocabulary toward open,
 * model-authored styling. The trade for that freedom is this module: a single
 * place that codifies *what must always remain true regardless of persona* —
 * the things that must stay visible, legible, and operable so a persona can
 * never restyle the app into something broken or unsafe.
 *
 * Everything here is pure and deterministic (no I/O, no model calls) so it can
 * run on untrusted model output before a theme is ever applied, and be unit
 * tested in isolation. `lintPersonaUi` reports violations; `repairPersonaUi`
 * returns a guaranteed-conformant theme plus the list of repairs it made.
 *
 * Today it enforces the invariants representable in `PersonaUiThemeV2`
 * (contrast, danger/success distinctness, motion caps, at least one identity
 * anchor). As the schema opens up (V3 open tokens, declarative layout), new
 * invariants — composer always present, min tap-target, modal legibility —
 * attach here so the guarantee grows with the freedom.
 */

import {
  type PersonaUiThemeV2,
  DEFAULT_PERSONA_UI_THEME,
  parseHexToRgb,
  contrastRatio,
  relativeLuminance,
  validateAndNormalizePersonaUiTheme,
} from "./persona_ui_theme.js";

/** Tunable thresholds for the invariants. Centralized so the bar is auditable. */
export const PERSONA_UI_INVARIANTS = {
  /** WCAG AA for normal body text against its surface. */
  minBodyContrast: 4.5,
  /** WCAG AA-large for accent/large/secondary text and chrome. */
  minLargeContrast: 3.0,
  /** Floor for muted/dim text so it never drops below "barely legible". */
  minMutedContrast: 2.8,
  /**
   * Minimum perceptual separation between the `danger` and `success` roles, so
   * an error state can never be confused with a healthy one. Measured as the
   * contrast ratio *between the two colors* (1 = identical, higher = farther).
   */
  minDangerSuccessSeparation: 1.6,
} as const;

export type PersonaUiInvariantId =
  | "contrast.accent"
  | "contrast.secondary"
  | "contrast.muted"
  | "contrast.danger"
  | "contrast.success"
  | "semantics.danger_success_distinct"
  | "identity.anchor_present";

export type PersonaUiViolationSeverity = "error" | "warn";

export interface PersonaUiViolation {
  id: PersonaUiInvariantId;
  severity: PersonaUiViolationSeverity;
  /** Human-readable explanation, safe to log or surface in a workbench. */
  message: string;
  /** The theme field(s) implicated, for targeted repair / telemetry. */
  fields: Array<keyof PersonaUiThemeV2>;
}

const ROLE_CONTRAST: Array<{
  id: PersonaUiInvariantId;
  field: keyof PersonaUiThemeV2;
  min: number;
}> = [
  { id: "contrast.accent", field: "accent", min: PERSONA_UI_INVARIANTS.minLargeContrast },
  { id: "contrast.secondary", field: "secondary", min: PERSONA_UI_INVARIANTS.minLargeContrast },
  { id: "contrast.muted", field: "muted", min: PERSONA_UI_INVARIANTS.minMutedContrast },
  { id: "contrast.danger", field: "danger", min: PERSONA_UI_INVARIANTS.minLargeContrast },
  { id: "contrast.success", field: "success", min: PERSONA_UI_INVARIANTS.minLargeContrast },
];

function contrastOf(hex: string, bgHex: string): number {
  const fg = parseHexToRgb(hex);
  const bg = parseHexToRgb(bgHex);
  if (!fg || !bg) return 0;
  return contrastRatio(fg, bg);
}

/**
 * Does this theme keep at least one orienting "who am I talking to" anchor that
 * is actually rendered? The `displayLabel` always exists (the normalizer
 * guarantees a non-empty fallback), so it only counts as an anchor when a
 * header is present to display it — otherwise the label is data nobody sees.
 */
function hasIdentityAnchor(theme: PersonaUiThemeV2): boolean {
  const labelShown = theme.headerStyle !== "none" && theme.displayLabel.trim().length > 0;
  const hasOrb = theme.orbStyle !== "hidden";
  const hasAvatar = theme.avatarStyle !== "none";
  return labelShown || hasOrb || hasAvatar;
}

/**
 * Report every invariant the given theme violates. Empty array = conformant.
 * Accepts raw/untrusted input — it is normalized first so a malformed theme is
 * linted against its *effective* (post-normalization) values.
 */
export function lintPersonaUi(raw: PersonaUiThemeV2 | unknown): PersonaUiViolation[] {
  const theme = validateAndNormalizePersonaUiTheme(raw);
  const violations: PersonaUiViolation[] = [];
  const bg = theme.surfaceTint;

  for (const role of ROLE_CONTRAST) {
    const ratio = contrastOf(theme[role.field] as string, bg);
    if (ratio < role.min) {
      violations.push({
        id: role.id,
        severity: "error",
        message: `${role.field} contrast ${ratio.toFixed(2)}:1 is below the ${role.min}:1 floor on surfaceTint ${bg}.`,
        fields: [role.field],
      });
    }
  }

  const dsSep = contrastOf(theme.danger, theme.success);
  if (dsSep < PERSONA_UI_INVARIANTS.minDangerSuccessSeparation) {
    violations.push({
      id: "semantics.danger_success_distinct",
      severity: "error",
      message: `danger and success are too similar (separation ${dsSep.toFixed(2)}); error and healthy states could be confused.`,
      fields: ["danger", "success"],
    });
  }

  if (!hasIdentityAnchor(theme)) {
    violations.push({
      id: "identity.anchor_present",
      severity: "error",
      message:
        "Theme hides every identity anchor (no label, orb, avatar, or header); the user loses all sense of who is replying.",
      fields: ["displayLabel", "orbStyle", "avatarStyle", "headerStyle"],
    });
  }

  return violations;
}

export interface PersonaUiRepairResult {
  theme: PersonaUiThemeV2;
  repairs: string[];
}

/**
 * Lighten a color toward legibility against a dark background while preserving
 * its hue, so a repaired danger/success role stays recognizably red/green.
 */
function liftLuminanceTowardContrast(hex: string, bgHex: string, min: number): string {
  const fg = parseHexToRgb(hex);
  const bg = parseHexToRgb(bgHex);
  if (!fg || !bg) return hex;
  let { r, g, b } = fg;
  for (let i = 0; i < 24 && contrastRatio({ r, g, b }, bg) < min; i++) {
    r = Math.min(255, r + (255 - r) * 0.18);
    g = Math.min(255, g + (255 - g) * 0.18);
    b = Math.min(255, b + (255 - b) * 0.18);
  }
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[c(r), c(g), c(b)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Return a theme guaranteed to satisfy {@link lintPersonaUi}, plus the list of
 * repairs applied. The normalizer already enforces most color contrast; this
 * closes the remaining invariants (danger/success distinctness, identity
 * anchor) deterministically rather than falling back to the default theme — so
 * a persona keeps as much of its authored intent as is safely possible.
 */
export function repairPersonaUi(raw: PersonaUiThemeV2 | unknown): PersonaUiRepairResult {
  let theme = validateAndNormalizePersonaUiTheme(raw);
  const repairs: string[] = [];

  // Distinctness first: restore BOTH roles to their well-separated, semantic
  // defaults (red danger / green success). Resetting only one cannot guarantee
  // separation when the persona's other role happens to collide with a default.
  if (contrastOf(theme.danger, theme.success) < PERSONA_UI_INVARIANTS.minDangerSuccessSeparation) {
    theme = {
      ...theme,
      danger: DEFAULT_PERSONA_UI_THEME.danger,
      success: DEFAULT_PERSONA_UI_THEME.success,
    };
    repairs.push(
      "Reset danger/success to semantic defaults so error and healthy states stay distinguishable."
    );
  }

  // Then enforce per-role contrast (covers any role just reset above too).
  for (const role of ROLE_CONTRAST) {
    if (contrastOf(theme[role.field] as string, theme.surfaceTint) < role.min) {
      const fixed = liftLuminanceTowardContrast(theme[role.field] as string, theme.surfaceTint, role.min);
      theme = { ...theme, [role.field]: fixed };
      repairs.push(`Lifted ${role.field} to ${fixed} for ${role.min}:1 contrast.`);
    }
  }

  if (!hasIdentityAnchor(theme)) {
    // Cheapest restoration: bring the header back. Keeps the rest of the look.
    theme = { ...theme, headerStyle: theme.headerStyle === "none" ? "bar" : theme.headerStyle };
    if (!hasIdentityAnchor(theme)) {
      theme = { ...theme, orbStyle: "ring" };
    }
    repairs.push("Restored an identity anchor (header/orb) so the user can tell who is replying.");
  }

  return { theme, repairs };
}

/** Convenience: is this theme already fully conformant (no error-severity violations)? */
export function isPersonaUiConformant(raw: PersonaUiThemeV2 | unknown): boolean {
  return lintPersonaUi(raw).every((v) => v.severity !== "error");
}

// Re-exported so consumers can reason about luminance without re-importing the theme module.
export { relativeLuminance };
