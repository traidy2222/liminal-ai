import React from "react";

const CYAN = "var(--lim-accent, #00d4ff)";

export type WorkspaceServiceGroup = {
  id: string;
  label: string;
  services: string[];
};

export type WorkspaceConnectPreset = {
  id: string;
  label: string;
  services: string[];
};

export interface WorkspaceServicePickerProps {
  groups: WorkspaceServiceGroup[];
  presets: WorkspaceConnectPreset[];
  selected: Set<string>;
  disabled?: boolean;
  onToggle: (serviceId: string) => void;
  onApplyPreset: (services: string[]) => void;
}

const chipBase: React.CSSProperties = {
  fontSize: 10,
  fontFamily: "monospace",
  padding: "4px 8px",
  borderRadius: 2,
  cursor: "pointer",
};

export function WorkspaceServicePicker({
  groups,
  presets,
  selected,
  disabled,
  onToggle,
  onApplyPreset,
}: WorkspaceServicePickerProps) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 6 }}>Quick presets</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
        {presets.map((p) => {
          const active =
            p.services.length === selected.size && p.services.every((s) => selected.has(s));
          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onApplyPreset(p.services)}
              style={{
                ...chipBase,
                border: `1px solid ${active ? CYAN : "rgba(var(--lim-accent-rgb),0.25)"}`,
                background: active ? "rgba(0, 212, 255, 0.08)" : "rgba(0, 12, 24, 0.6)",
                color: active ? CYAN : "#aab8c4",
                cursor: disabled ? "default" : "pointer",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {groups.map((group) => (
        <div key={group.id} style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: "#778899", marginBottom: 4, letterSpacing: "0.04em" }}>
            {group.label.toUpperCase()}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {group.services.map((s) => (
              <label
                key={s}
                style={{
                  ...chipBase,
                  display: "inline-flex",
                  alignItems: "center",
                  border: `1px solid ${selected.has(s) ? CYAN : "rgba(var(--lim-accent-rgb),0.2)"}`,
                  color: selected.has(s) ? CYAN : "#8899aa",
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(s)}
                  onChange={() => onToggle(s)}
                  disabled={disabled}
                  style={{ marginRight: 4 }}
                />
                {s}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
