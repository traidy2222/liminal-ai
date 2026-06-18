import React from "react";

const GREEN = "#6ee7b7";
const MAGENTA = "var(--lim-secondary, #ff4488)";

export type IntegrationAccountEntry = {
  accountId: string;
  label: string;
  meta?: string;
};

const btnDanger: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 10,
  padding: "4px 8px",
  borderRadius: 2,
  border: "1px solid rgba(255,68,136,0.35)",
  background: "rgba(0,12,24,0.8)",
  color: MAGENTA,
  cursor: "pointer",
};

export function IntegrationAccountsList({
  accounts,
  disabled,
  onRemove,
  onDisconnectAll,
  disconnectAllLabel = "Disconnect all",
}: {
  accounts: IntegrationAccountEntry[];
  disabled?: boolean;
  onRemove: (accountId: string) => void | Promise<void>;
  onDisconnectAll?: () => void | Promise<void>;
  disconnectAllLabel?: string;
}) {
  if (accounts.length === 0) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#8899aa", fontWeight: 600, marginBottom: 6 }}>
        {accounts.length === 1 ? "Linked account" : `${accounts.length} linked accounts`}
      </div>
      {accounts.map((a) => (
        <div
          key={a.accountId}
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginBottom: 6,
            fontSize: 11,
            fontFamily: "monospace",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: GREEN }}>{a.label}</div>
            {a.meta ? (
              <div style={{ color: "#667788", fontSize: 10, lineHeight: 1.35 }}>{a.meta}</div>
            ) : null}
          </div>
          <button
            type="button"
            style={btnDanger}
            disabled={disabled}
            onClick={() => void onRemove(a.accountId)}
          >
            Remove
          </button>
        </div>
      ))}
      {onDisconnectAll ? (
        <button
          type="button"
          style={{ ...btnDanger, marginTop: 4 }}
          disabled={disabled}
          onClick={() => void onDisconnectAll()}
        >
          {disconnectAllLabel}
        </button>
      ) : null}
    </div>
  );
}
