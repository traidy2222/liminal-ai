/**
 * Persona UI layout spec (Phase 2) — declarative region arrangement.
 *
 * Replaces "pick one of four hardcoded shells" with a small, validated
 * description of which regions are present and how they're arranged. The
 * persona's `shell`/`headerStyle`/`panelLayout`/`inputDock` enums *seed* a
 * layout (so existing personas keep working with zero migration), and open
 * fields (`transcriptMaxWidth`) let the model go past the presets.
 *
 * The composer is intentionally NOT optional — it is a structural invariant
 * (you can always type), enforced by construction here rather than by a runtime
 * check. Identity-anchor and contrast invariants live in `persona_ui_invariants`.
 */

import {
  type PersonaUiThemeV2,
  type PersonaUiBackground,
  validateAndNormalizePersonaUiTheme,
  resolvePersonaPanelSides,
} from "./persona_ui_theme.js";

export type PersonaComposerDock = "bottom-bar" | "floating" | "inline";
export type PersonaHeaderStyle = "bar" | "pill";
export type PersonaHeaderAlign = "start" | "center";

export interface PersonaLayoutSpec {
  v: 1;
  header: { present: boolean; style: PersonaHeaderStyle; align: PersonaHeaderAlign };
  leftPanel: boolean;
  rightPanel: boolean;
  /** Composer is always present (structural invariant); only its dock varies. */
  composer: { dock: PersonaComposerDock };
  /** 0 = transcript fills available width; otherwise a px max-width cap. */
  transcriptMaxWidth: number;
  background: PersonaUiBackground;
}

const TRANSCRIPT_WIDTH_RANGE = [0, 1200] as const;

function clampWidth(raw: unknown): number | undefined {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return undefined;
  return Math.max(TRANSCRIPT_WIDTH_RANGE[0], Math.min(TRANSCRIPT_WIDTH_RANGE[1], Math.round(n)));
}

/**
 * Seed a layout from a persona theme's enums. Pure projection — no validation
 * needed because every input is already a normalized enum.
 */
export function deriveLayoutFromTheme(rawTheme: PersonaUiThemeV2 | unknown): PersonaLayoutSpec {
  const t = validateAndNormalizePersonaUiTheme(rawTheme);
  const panels = resolvePersonaPanelSides(t);
  const headerPresent = t.headerStyle !== "none";
  return {
    v: 1,
    header: {
      present: headerPresent,
      style: t.headerStyle === "pill" ? "pill" : "bar",
      // Minimal/centered shells read better with a centered brand.
      align: t.shell === "minimal" || t.shell === "studio" ? "center" : "start",
    },
    leftPanel: panels.left,
    rightPanel: panels.right,
    composer: { dock: t.inputDock },
    // Studio/minimal personas read better with a capped column; HUD/terminal fill.
    transcriptMaxWidth: t.shell === "studio" || t.shell === "minimal" ? 820 : 0,
    background: t.background,
  };
}

/**
 * Validate/normalize an (optionally model-authored) layout against a theme.
 * Unknown/missing fields fall back to the theme-derived seed; the composer is
 * guaranteed present regardless of input.
 */
export function validatePersonaLayout(
  raw: unknown,
  theme: PersonaUiThemeV2 | unknown
): PersonaLayoutSpec {
  const seed = deriveLayoutFromTheme(theme);
  if (!raw || typeof raw !== "object") return seed;
  const o = raw as Record<string, unknown>;

  const headerRaw = o["header"];
  const ho = headerRaw && typeof headerRaw === "object" ? (headerRaw as Record<string, unknown>) : {};
  const composerRaw = o["composer"];
  const co =
    composerRaw && typeof composerRaw === "object" ? (composerRaw as Record<string, unknown>) : {};

  const dock = co["dock"];
  const dockValid: PersonaComposerDock =
    dock === "bottom-bar" || dock === "floating" || dock === "inline" ? dock : seed.composer.dock;

  const width = clampWidth(o["transcriptMaxWidth"]);

  return {
    v: 1,
    header: {
      present: typeof ho["present"] === "boolean" ? (ho["present"] as boolean) : seed.header.present,
      style: ho["style"] === "pill" ? "pill" : ho["style"] === "bar" ? "bar" : seed.header.style,
      align:
        ho["align"] === "center" ? "center" : ho["align"] === "start" ? "start" : seed.header.align,
    },
    leftPanel: typeof o["leftPanel"] === "boolean" ? (o["leftPanel"] as boolean) : seed.leftPanel,
    rightPanel: typeof o["rightPanel"] === "boolean" ? (o["rightPanel"] as boolean) : seed.rightPanel,
    composer: { dock: dockValid },
    transcriptMaxWidth: width ?? seed.transcriptMaxWidth,
    background: seed.background,
  };
}
