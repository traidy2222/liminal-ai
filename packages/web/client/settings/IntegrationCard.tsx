import React from "react";
import { INTEGRATION_BRANDS, IntegrationBrandLogo, type IntegrationBrandId } from "./integrationBrands.js";
import { IntegrationConnectionStatus } from "./integrationStatus.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const MAGENTA = "var(--lim-secondary, #ff4488)";

const btn: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  padding: "8px 14px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  background: "rgba(0,12,24,0.8)",
  color: CYAN,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = { ...btn, color: MAGENTA, borderColor: "rgba(255,68,136,0.35)" };

export function IntegrationCard({
  brandId,
  statusLine,
  connected,
  statusMode = "simple",
  signedIn,
  toolsAttached,
  expanded,
  onToggle,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryDanger,
  hidePrimary,
  children,
}: {
  brandId: IntegrationBrandId;
  statusLine: string;
  connected: boolean;
  statusMode?: "simple" | "oauth_mcp" | "oauth_auto_attach";
  signedIn?: boolean;
  toolsAttached?: boolean;
  expanded: boolean;
  onToggle: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryDanger?: boolean;
  hidePrimary?: boolean;
  children?: React.ReactNode;
}) {
  const brand = INTEGRATION_BRANDS[brandId];
  return (
    <div
      style={{
        gridColumn: expanded ? "1 / -1" : undefined,
        borderRadius: 10,
        border: `1px solid ${connected ? "rgba(0,255,136,0.35)" : "rgba(var(--lim-accent-rgb),0.14)"}`,
        background: connected ? "rgba(0,255,136,0.04)" : "rgba(0,12,24,0.65)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: expanded ? undefined : 196,
      }}
    >
      <div
        style={{
          padding: "14px 12px 12px",
          cursor: "pointer",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
      >
        <IntegrationBrandLogo id={brandId} size={52} />
        <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>{brand.title}</div>
        <div style={{ fontSize: 11, color: "#8fa0b0", marginTop: 4, lineHeight: 1.4, minHeight: 30 }}>
          {statusLine}
        </div>
        <div style={{ marginTop: 8 }}>
          <IntegrationConnectionStatus
            mode={statusMode}
            signedIn={signedIn}
            toolsAttached={toolsAttached}
            simpleConnected={connected}
          />
        </div>
        {hidePrimary ? (
          <div style={{ fontSize: 10, color: "#667788", marginTop: 10 }}>Tap for options</div>
        ) : (
          <button
            type="button"
            style={{
              ...(primaryDanger ? btnDanger : btn),
              marginTop: 10,
              width: "100%",
              maxWidth: 140,
            }}
            disabled={primaryDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onPrimary();
            }}
          >
            {primaryLabel}
          </button>
        )}
        <div style={{ fontSize: 10, color: "#556677", marginTop: 8 }}>
          {expanded ? "Hide options ▴" : "More options ▾"}
        </div>
      </div>
      {expanded && children ? (
        <div
          style={{
            padding: "12px 14px 14px",
            borderTop: "1px solid rgba(var(--lim-accent-rgb),0.1)",
            textAlign: "left",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
