import React from "react";
import { summarizeWorkingPanel, type TurnRow } from "./chatTurnLayout.js";

const CYAN = "var(--lim-accent, #00d4ff)";

export function WorkingPanel({
  working,
  isActive,
  children,
}: {
  working: TurnRow[];
  isActive: boolean;
  children: React.ReactNode;
}) {
  if (working.length === 0) return null;

  return (
    <details
      open={isActive}
      style={{
        margin: "4px 0 10px",
        padding: "8px 12px",
        borderRadius: 6,
        background: "rgba(0, 8, 16, 0.45)",
        border: "1px solid rgba(var(--lim-accent-rgb), 0.1)",
      }}
    >
      <summary
        style={{
          cursor: "pointer",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          fontSize: 11,
          color: CYAN,
          letterSpacing: "0.04em",
          userSelect: "none",
          listStyle: "none",
        }}
      >
        {summarizeWorkingPanel(working)}
        {isActive && (
          <span style={{ marginLeft: 8, color: "rgba(var(--lim-accent-rgb), 0.45)", animation: "blink 1s step-end infinite" }}>
            …
          </span>
        )}
      </summary>
      <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </details>
  );
}
