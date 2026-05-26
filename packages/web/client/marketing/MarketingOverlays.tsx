import React, { useState } from "react";
import { PERSONA_QUICK_PRESETS } from "@liminal/core/persona-bootstrap-ui";
import { categoryForTool } from "../persona/categoryMeta.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const GREEN = "var(--lim-success, #00ff88)";
const MAGENTA = "var(--lim-secondary, #ff4488)";
const RED_ERR = "var(--lim-danger, #ff2244)";

const modal: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
  padding: 20,
};

const modalBox: React.CSSProperties = {
  background: "rgba(2,6,14,0.98)",
  border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
  borderRadius: 6,
  padding: "22px 24px",
  width: "min(560px, 92vw)",
  boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
};

const btn: React.CSSProperties = {
  background: "rgba(0,10,20,0.6)",
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  borderRadius: 3,
  color: "#aabbcc",
  padding: "8px 14px",
  cursor: "pointer",
  fontSize: 12,
};

export function MarketingPersonaBootstrap() {
  const [input, setInput] = useState(
    "A sharp, witty senior engineer — direct, dry humor, explains the tradeoff, never fluff."
  );
  return (
    <div style={modal} role="dialog" aria-modal="true">
      <div style={modalBox}>
        <div
          style={{
            color: CYAN,
            fontWeight: 700,
            marginBottom: 6,
            fontSize: 11,
            letterSpacing: "0.12em",
            fontFamily: "monospace",
          }}
        >
          ◆ WELCOME — PERSONALITY
        </div>
        <div style={{ marginBottom: 10, color: "#c8d4e0", lineHeight: 1.65, fontSize: 14 }}>
          Choose how the assistant should <strong style={{ color: "#e8f0ff" }}>sound</strong> (tone, pace,
          humor). Tools, safety, and task behavior stay the same.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
          {PERSONA_QUICK_PRESETS.slice(0, 4).map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setInput(preset)}
              style={{ ...btn, fontSize: 11, maxWidth: "100%", textAlign: "left" }}
            >
              {preset.length > 52 ? `${preset.slice(0, 50)}…` : preset}
            </button>
          ))}
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          rows={4}
          style={{
            width: "100%",
            background: "rgba(0,6,16,0.9)",
            border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
            borderRadius: 4,
            color: "#dde8f0",
            padding: 12,
            fontSize: 14,
            lineHeight: 1.5,
            resize: "vertical",
            fontFamily: "inherit",
          }}
        />
        <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button type="button" style={{ ...btn, color: CYAN, flex: 1, minWidth: 140 }}>
            SAVE VOICE · START
          </button>
          <button type="button" style={{ ...btn, flex: 1, minWidth: 140 }}>
            USE DEFAULT VOICE
          </button>
        </div>
        <p style={{ marginTop: 12, fontSize: 11, color: "#556677", fontStyle: "italic" }}>
          Use default voice skips generation and completes first-run setup.
        </p>
      </div>
    </div>
  );
}

export function MarketingApprovalOverlay() {
  const toolName = "run_shell";
  const cat = categoryForTool(toolName);
  const args = {
    command: "docker volume prune -f && docker image prune -af",
  };
  return (
    <div style={modal}>
      <div
        style={{
          ...modalBox,
          width: "min(640px, 92vw)",
          borderColor: "rgba(var(--lim-secondary-rgb),0.35)",
          position: "relative",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: MAGENTA, fontWeight: 700, fontSize: 12, letterSpacing: "0.1em", fontFamily: "monospace" }}>
              ⚠ AUTHORIZATION REQUIRED
            </span>
            <span style={{ color: cat.color, fontWeight: 700, fontSize: 13, fontFamily: "monospace" }}>
              {cat.icon} {toolName}
            </span>
          </div>
          <span style={{ color: "#8899aa", fontSize: 10, fontFamily: "monospace" }}>auto-reject 1:58</span>
        </div>
        <div
          style={{
            background: "rgba(0,4,12,0.8)",
            border: "1px solid rgba(var(--lim-accent-rgb),0.08)",
            borderRadius: 4,
            padding: "10px 12px",
            fontFamily: "monospace",
            fontSize: 11,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: "6px 12px" }}>
            <span style={{ color: "#556677" }}>command</span>
            <span style={{ color: "#ccddee", wordBreak: "break-all" }}>{args.command}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button
            type="button"
            style={{ ...btn, background: "rgba(0,30,12,0.8)", borderColor: `rgba(var(--lim-success-rgb),0.3)`, color: GREEN, flex: 1 }}
          >
            ✓ AUTHORIZE
          </button>
          <button
            type="button"
            style={{ ...btn, background: "rgba(30,4,8,0.8)", borderColor: `rgba(var(--lim-danger-rgb),0.3)`, color: RED_ERR, flex: 1 }}
          >
            ✗ DENY
          </button>
        </div>
      </div>
    </div>
  );
}
