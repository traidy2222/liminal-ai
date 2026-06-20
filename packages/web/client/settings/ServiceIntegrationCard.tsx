import React from "react";
import { IntegrationBrandLogo, type IntegrationBrandId } from "./integrationBrands.js";
import { IntegrationConnectionStatus } from "./integrationStatus.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const GREEN = "var(--lim-success, #00ff88)";

const btn: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 10,
  padding: "6px 10px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  background: "rgba(0,12,24,0.8)",
  color: CYAN,
  cursor: "pointer",
};

export interface ServiceCardViewModel {
  vendor: IntegrationBrandId;
  serviceId: string;
  label: string;
  groupLabel: string;
  connected: boolean;
  signedIn: boolean;
  toolCount: number;
  needsScopeReconnect: boolean;
  restOnly?: boolean;
}

export function ServiceIntegrationCard({
  card,
  expanded,
  disabled,
  onToggle,
  onConnect,
  children,
}: {
  card: ServiceCardViewModel;
  expanded: boolean;
  disabled?: boolean;
  onToggle: () => void;
  onConnect: () => void;
  children?: React.ReactNode;
}) {
  const statusLine = card.connected
    ? card.toolCount > 0
      ? `Ready · ${card.toolCount} tools`
      : card.restOnly
        ? "Scopes granted"
        : "Connected"
    : card.needsScopeReconnect
      ? "Reconnect for scopes"
      : card.signedIn
        ? "Tap to enable"
        : card.groupLabel;

  return (
    <div
      style={{
        gridColumn: expanded ? "1 / -1" : undefined,
        borderRadius: 8,
        border: `1px solid ${card.connected ? "rgba(0,255,136,0.35)" : "rgba(var(--lim-accent-rgb),0.12)"}`,
        background: card.connected ? "rgba(0,255,136,0.04)" : "rgba(0,12,24,0.55)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: expanded ? undefined : 168,
      }}
    >
      <div
        style={{
          padding: "10px 10px 8px",
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
        <IntegrationBrandLogo id={card.vendor} size={36} />
        <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: "#e8f0f8", lineHeight: 1.25 }}>
          {card.label}
        </div>
        <div style={{ fontSize: 10, color: "#8fa0b0", marginTop: 4, lineHeight: 1.35, minHeight: 28 }}>
          {statusLine}
        </div>
        <div style={{ marginTop: 6 }}>
          <IntegrationConnectionStatus
            mode="oauth_auto_attach"
            signedIn={card.signedIn}
            toolsAttached={card.connected}
            simpleConnected={card.connected}
          />
        </div>
        {!card.connected ? (
          <button
            type="button"
            style={{ ...btn, marginTop: 8, width: "100%", maxWidth: 120 }}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              onConnect();
            }}
          >
            Connect
          </button>
        ) : (
          <div style={{ fontSize: 10, color: GREEN, marginTop: 8 }}>Active</div>
        )}
        <div style={{ fontSize: 9, color: "#556677", marginTop: 6 }}>
          {expanded ? "Hide ▴" : "Options ▾"}
        </div>
      </div>
      {expanded && children ? (
        <div
          style={{
            padding: "10px 12px 12px",
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

export function IntegrationCategorySection({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section style={{ gridColumn: "1 / -1", marginBottom: 4 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#dde8f0", letterSpacing: "0.04em" }}>{title}</div>
        {subtitle ? (
          <div style={{ fontSize: 11, color: "#8899aa", marginTop: 4, lineHeight: 1.45 }}>{subtitle}</div>
        ) : null}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
          gap: 10,
          alignItems: "stretch",
        }}
      >
        {children}
      </div>
      {footer ? <div style={{ marginTop: 10 }}>{footer}</div> : null}
    </section>
  );
}
