import type React from "react";
import type { ShellContract } from "../ShellContract.js";

/**
 * Mandatory shell control cluster — Settings, New session, Raw toggle.
 *
 * Every persona shell MUST render this component. It is the single source of
 * truth for the controls a user needs regardless of which generated persona
 * style is active. A shell that omits it strands the user with no way to reach
 * Settings or reset the session — see ShellContract.ts "Required controls".
 *
 * Styling inherits the active persona palette through CSS variables
 * (--lim-accent-rgb, --lim-accent), so the cluster fits every theme.
 *
 * Access rules:
 *   - Settings    — always enabled (must stay reachable even mid-turn).
 *   - New session — disabled while busy (avoids resetting an in-flight turn).
 *   - Raw toggle  — always enabled (view-only toggle).
 */
export function ShellControls({
  contract,
  tone = "mono",
  style,
}: {
  contract: ShellContract;
  /** "mono" = uppercase monospace (terminal/hud); "soft" = rounded sentence-case (studio/minimal). */
  tone?: "mono" | "soft";
  style?: React.CSSProperties;
}) {
  const { busy, showRawHarness, onOpenSettings, onClearSession, onToggleRaw } = contract;
  const mono = tone === "mono";

  const base: React.CSSProperties = {
    background: "transparent",
    border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
    borderRadius: mono ? 2 : 8,
    color: "rgba(var(--lim-accent-rgb),0.55)",
    padding: mono ? "3px 10px" : "4px 12px",
    fontSize: mono ? 9 : 11,
    cursor: "pointer",
    fontFamily: mono
      ? "var(--lim-font-mono, Consolas, monospace)"
      : "var(--lim-font-body, system-ui, sans-serif)",
    letterSpacing: mono ? "0.1em" : "0.01em",
    fontWeight: mono ? 400 : 600,
    whiteSpace: "nowrap",
    lineHeight: 1.4,
    transition: "color 0.15s, border-color 0.15s",
  };

  const label = (text: string) => (mono ? text.toUpperCase() : text);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, ...style }}>
      <button
        type="button"
        style={base}
        onClick={() => onOpenSettings()}
        title="Open settings"
      >
        {label("Settings")}
      </button>
      <button
        type="button"
        style={{ ...base, opacity: busy ? 0.4 : 1, cursor: busy ? "default" : "pointer" }}
        disabled={busy}
        onClick={() => void onClearSession()}
        title="Start a new session"
      >
        {label("New session")}
      </button>
      <button
        type="button"
        style={{
          ...base,
          borderColor: showRawHarness
            ? "rgba(var(--lim-accent-rgb),0.5)"
            : "rgba(var(--lim-accent-rgb),0.2)",
          color: showRawHarness
            ? "var(--lim-accent, #00d4ff)"
            : "rgba(var(--lim-accent-rgb),0.55)",
        }}
        onClick={() => onToggleRaw()}
        title={showRawHarness ? "Hide raw harness trace" : "Show raw harness trace"}
      >
        {label("Raw")} {showRawHarness ? "●" : "○"}
      </button>
    </div>
  );
}
