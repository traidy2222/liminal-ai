import type { CSSProperties } from "react";
import {
  migratePersonaUiTheme,
  shellDefaultShowSidePanels,
  type PersonaUiShell,
  type PersonaUiThemeV2,
  type PersonaUiAvatarStyle,
  type PersonaUiMessageEntrance,
} from "@liminal/core/persona-ui-theme";
import { LIM } from "./personaVars.js";

export function resolveShell(theme: PersonaUiThemeV2 | null): PersonaUiShell {
  return migratePersonaUiTheme(theme).shell;
}

export function shouldShowSidePanels(shell: PersonaUiShell, windowWidth: number): boolean {
  if (!shellDefaultShowSidePanels(shell)) return false;
  return windowWidth >= 900;
}

function backgroundLayers(shell: PersonaUiShell, background: PersonaUiThemeV2["background"]): string {
  const accentGrid = `linear-gradient(rgba(var(--lim-accent-rgb),0.022) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--lim-accent-rgb),0.022) 1px, transparent 1px)`;
  const scanline = `repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(var(--lim-accent-rgb),0.03) 2px, rgba(var(--lim-accent-rgb),0.03) 4px)`;
  const gradient = `radial-gradient(ellipse at 50% 0%, rgba(var(--lim-accent-rgb),0.28) 0%, transparent 62%)`;

  if (shell === "terminal" || background === "scanline") {
    return [scanline, accentGrid].join(", ");
  }
  if (shell === "studio" || background === "gradient") {
    return [gradient, `linear-gradient(180deg, ${LIM.surface} 0%, ${LIM.bg} 100%)`].join(", ");
  }
  if (background === "solid" || shell === "minimal") {
    return `linear-gradient(180deg, ${LIM.surface} 0%, ${LIM.bg} 100%)`;
  }
  return [
    gradient,
    accentGrid,
  ].join(", ");
}

export function buildShellRootStyle(theme: PersonaUiThemeV2 | null): CSSProperties {
  const t = migratePersonaUiTheme(theme);
  const scale = t.density === "compact" ? 0.92 : t.density === "spacious" ? 1.08 : 1;
  const layers = backgroundLayers(t.shell, t.background);
  const backgroundImage = t.backgroundCss ? `${t.backgroundCss}, ${layers}` : layers;
  return {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: LIM.bg,
    color: LIM.text,
    fontFamily: LIM.fontBody,
    fontSize: `${Math.round(14 * scale)}px`,
    backgroundImage,
    backgroundSize:
      t.shell === "terminal" ? "auto, 32px 32px, 32px 32px" : "auto, 44px 44px, 44px 44px",
  };
}

export function buildShellBodyStyle(shell: PersonaUiShell): CSSProperties {
  if (shell === "minimal") {
    return {
      display: "flex",
      flex: 1,
      flexDirection: "column",
      overflow: "hidden",
      minHeight: 0,
      maxWidth: 920,
      margin: "0 auto",
      width: "100%",
    };
  }
  return {
    display: "flex",
    flex: 1,
    overflow: "hidden",
    minHeight: 0,
  };
}

export function buildMessagesStyle(
  theme: PersonaUiThemeV2 | null
): CSSProperties {
  const t = migratePersonaUiTheme(theme);
  const pad = t.density === "compact" ? 10 : t.density === "spacious" ? 18 : 14;
  return {
    flex: 1,
    overflowY: "auto",
    padding: `${pad}px ${pad + 6}px`,
    display: "flex",
    flexDirection: "column",
    gap: t.density === "compact" ? 5 : 8,
  };
}

export function buildUserMessageStyle(theme: PersonaUiThemeV2 | null): CSSProperties {
  const t = migratePersonaUiTheme(theme);
  const radius =
    t.messageStyle === "transcript"
      ? 0
      : t.radius === "pill"
        ? 16
        : t.radius === "sharp"
          ? 2
          : 6;
  const base: CSSProperties = {
    padding: t.messageStyle === "transcript" ? "4px 0" : "8px 12px",
    lineHeight: 1.5,
    borderRadius: radius,
  };
  if (t.messageStyle === "flat" || t.messageStyle === "transcript") {
    return {
      ...base,
      borderLeft: `2px solid ${LIM.accent}`,
      background: "transparent",
    };
  }
  return {
    ...base,
    background: LIM.userBg,
    borderLeft: `2px solid ${LIM.accent}`,
    boxShadow: "inset 0 0 20px rgba(var(--lim-accent-rgb),0.02)",
  };
}

export function buildAssistantMessageStyle(): CSSProperties {
  return {
    padding: "5px 0",
    color: LIM.assistant,
    lineHeight: 1.65,
  };
}

export function orbHidden(shell: PersonaUiShell, orbStyle: PersonaUiThemeV2["orbStyle"]): boolean {
  return orbStyle === "hidden" || (shell === "minimal" && orbStyle !== "ring");
}

/** Styles for the input area based on inputStyle. */
export function buildInputAreaStyle(theme: PersonaUiThemeV2 | null): CSSProperties {
  const t = migratePersonaUiTheme(theme);
  const base: CSSProperties = { fontFamily: LIM.fontBody, width: "100%", resize: "none", outline: "none" };
  switch (t.inputStyle) {
    case "command":
      return {
        ...base,
        background: "rgba(0,0,0,0.6)",
        border: "none",
        borderTop: `1px solid rgba(var(--lim-accent-rgb),0.15)`,
        color: LIM.accent,
        fontFamily: LIM.fontMono,
        padding: "10px 14px",
        fontSize: 13,
        letterSpacing: "0.02em",
      };
    case "document":
      return {
        ...base,
        background: `rgba(var(--lim-surface-rgb),0.55)`,
        border: `1px solid rgba(var(--lim-accent-rgb),0.1)`,
        borderRadius: 8,
        color: LIM.text,
        padding: "12px 16px",
        fontSize: 14,
        lineHeight: 1.7,
        minHeight: 80,
        boxShadow: `inset 0 0 0 1px rgba(var(--lim-accent-rgb),0.05), 0 2px 12px rgba(0,0,0,0.18)`,
      };
    case "minimal":
      return {
        ...base,
        background: "transparent",
        border: "none",
        borderBottom: `1px solid rgba(var(--lim-accent-rgb),0.22)`,
        borderRadius: 0,
        color: LIM.text,
        padding: "8px 0",
        fontSize: 14,
      };
    default:
      return {};
  }
}

/** CSS class name to add for message entrance animation. */
export function messageEntranceClass(entrance: PersonaUiMessageEntrance): string {
  if (entrance === "fade") return "msg-entrance-fade";
  if (entrance === "slide") return "msg-entrance-slide";
  if (entrance === "typewriter") return "msg-entrance-typewriter";
  return "";
}

/** Left-edge stripe style for avatarStyle="stripe" on assistant messages. */
export function buildAvatarStripeStyle(): CSSProperties {
  return {
    borderLeft: `3px solid ${LIM.assistant}`,
    paddingLeft: 10,
    marginLeft: 2,
  };
}

/** Inline glyph element style for avatarStyle="glyph". */
export function buildAvatarGlyphStyle(avatarStyle: PersonaUiAvatarStyle): CSSProperties {
  if (avatarStyle !== "glyph") return {};
  return {
    display: "inline-block",
    marginRight: 7,
    color: LIM.accent,
    fontWeight: 700,
    fontSize: "0.9em",
    flexShrink: 0,
  };
}
