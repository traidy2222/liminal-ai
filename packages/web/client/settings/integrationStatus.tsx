import React from "react";

const GREEN = "var(--lim-success, #00ff88)";
const AMBER = "var(--lim-warn, #ffb347)";

export function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: "monospace",
        padding: "2px 8px",
        borderRadius: 2,
        border: `1px solid ${ok ? GREEN : AMBER}`,
        color: ok ? GREEN : AMBER,
      }}
    >
      {label}
    </span>
  );
}

/** Two-step workspace providers: OAuth sign-in, then MCP tool attach. */
export function IntegrationConnectionStatus({
  mode,
  signedIn,
  toolsAttached,
  simpleConnected,
}: {
  mode: "oauth_mcp" | "oauth_auto_attach" | "simple";
  signedIn?: boolean;
  toolsAttached?: boolean;
  simpleConnected?: boolean;
}) {
  if (mode === "simple") {
    return <StatusPill ok={simpleConnected === true} label={simpleConnected ? "Connected" : "Not connected"} />;
  }
  if (mode === "oauth_auto_attach") {
    return <StatusPill ok={signedIn === true} label={signedIn ? "Signed in" : "Not signed in"} />;
  }
  return (
    <div style={{ display: "flex", gap: 6, justifyContent: "center", flexWrap: "wrap" }}>
      <StatusPill ok={signedIn === true} label={signedIn ? "Signed in" : "Sign in"} />
      <StatusPill ok={toolsAttached === true} label={toolsAttached ? "Tools on" : "Tools off"} />
    </div>
  );
}
