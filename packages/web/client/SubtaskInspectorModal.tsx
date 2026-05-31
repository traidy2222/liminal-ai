import React, { useEffect, useRef } from "react";
import type { SubtaskEntry, SubtaskToolCallEntry } from "./useSSE.js";
import { categoryForTool } from "./persona/categoryMeta.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const GREEN = "var(--lim-success, #00ff88)";
const RED = "var(--lim-danger, #ff4466)";
const MAGENTA = "var(--lim-secondary, #c084fc)";

export function SubtaskInspectorModal({
  entry,
  onClose,
}: {
  entry: SubtaskEntry;
  onClose: () => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const statusColor =
    entry.status === "running" ? CYAN : entry.status === "done" ? GREEN : entry.status === "error" ? RED : "#556677";
  const statusLabel =
    entry.status === "running" ? "Running" : entry.status === "done" ? "Done" : entry.status === "error" ? "Failed" : "Cancelled";

  const toolCalls = entry.toolCalls ?? [];
  const traceLog = entry.traceLog ?? "";

  useEffect(() => {
    if (entry.status === "running" && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [toolCalls.length, entry.partialOutput, traceLog, entry.status]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const textBody = (entry.finalOutput || entry.partialOutput || "").trim();

  return (
    <div
      style={modalBackdrop}
      role="dialog"
      aria-modal="true"
      aria-labelledby="subtask-inspector-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div style={modalBox}>
        <div style={headerRow}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div id="subtask-inspector-title" style={titleStyle}>
              Sub-agent · {entry.taskId.slice(0, 8)}
            </div>
            <div style={{ fontSize: 12, color: "#99aabb", marginTop: 4, lineHeight: 1.45 }}>{entry.goal}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: statusColor,
                border: `1px solid ${statusColor}55`,
                borderRadius: 4,
                padding: "2px 8px",
              }}
            >
              {statusLabel}
            </span>
            <button type="button" onClick={onClose} style={closeBtn} aria-label="Close">
              ✕
            </button>
          </div>
        </div>

        <div ref={scrollRef} style={bodyScroll}>
          <section style={section}>
            <div style={sectionLabel}>Tool activity ({toolCalls.length})</div>
            {toolCalls.length === 0 ? (
              <div style={emptyHint}>
                {entry.status === "running"
                  ? "Waiting for tool calls…"
                  : "No tool calls recorded for this sub-agent."}
              </div>
            ) : (
              toolCalls.map((tc: SubtaskToolCallEntry) => {
                const cat = categoryForTool(tc.name);
                const tcColor = tc.status === "running" ? CYAN : tc.ok ? GREEN : RED;
                return (
                  <details key={tc.callId} style={toolBlock} open={tc.status === "running"}>
                    <summary style={{ cursor: "pointer", listStyle: "none", display: "flex", gap: 8, alignItems: "center" }}>
                      <span style={{ color: cat.color }}>{cat.icon}</span>
                      <span style={{ color: "#ccddee", fontWeight: 600 }}>{tc.name}</span>
                      <span style={{ color: tcColor, fontSize: 10 }}>{tc.status === "running" ? "⟳" : tc.ok ? "✓" : "✗"}</span>
                    </summary>
                    {tc.args && Object.keys(tc.args).length > 0 && (
                      <pre style={preBlock}>{JSON.stringify(tc.args, null, 2).slice(0, 4000)}</pre>
                    )}
                    {tc.output && (
                      <pre style={{ ...preBlock, borderColor: `${tcColor}33`, color: tc.ok ? "#aabbcc" : RED }}>
                        {tc.output.slice(0, 12000)}
                        {tc.output.length > 12000 ? "\n…[truncated]" : ""}
                      </pre>
                    )}
                  </details>
                );
              })
            )}
          </section>

          {textBody.length > 0 && (
            <section style={section}>
              <div style={sectionLabel}>Assistant output</div>
              <pre style={{ ...preBlock, whiteSpace: "pre-wrap" as const }}>{textBody}</pre>
            </section>
          )}

          {traceLog.trim().length > 0 && (
            <section style={section}>
              <div style={sectionLabel}>Harness trace</div>
              <pre style={{ ...preBlock, color: "#556677", fontSize: 10 }}>{traceLog.slice(-8000)}</pre>
            </section>
          )}
        </div>

        <div style={footerHint}>Click outside or press Esc to close · depth {entry.depth}</div>
      </div>
    </div>
  );
}

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 9000,
  background: "rgba(0, 8, 20, 0.82)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const modalBox: React.CSSProperties = {
  width: "min(720px, 96vw)",
  maxHeight: "min(82vh, 900px)",
  display: "flex",
  flexDirection: "column",
  background: "linear-gradient(180deg, rgba(4,12,24,0.98) 0%, rgba(2,8,18,0.99) 100%)",
  border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.18)",
  borderRadius: 8,
  boxShadow: "0 24px 80px rgba(0,0,0,0.55)",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
};

const headerRow: React.CSSProperties = {
  display: "flex",
  gap: 12,
  padding: "14px 16px 12px",
  borderBottom: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.08)",
};

const titleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: MAGENTA,
  letterSpacing: "0.04em",
};

const closeBtn: React.CSSProperties = {
  background: "none",
  border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.15)",
  borderRadius: 4,
  color: "#8899aa",
  cursor: "pointer",
  fontSize: 14,
  lineHeight: 1,
  padding: "4px 8px",
};

const bodyScroll: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  padding: "12px 16px 16px",
  display: "flex",
  flexDirection: "column",
  gap: 14,
};

const section: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const sectionLabel: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.45)",
};

const emptyHint: React.CSSProperties = {
  fontSize: 11,
  color: "#556677",
  fontStyle: "italic",
};

const toolBlock: React.CSSProperties = {
  border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.08)",
  borderRadius: 4,
  padding: "8px 10px",
  background: "rgba(0, 6, 16, 0.55)",
};

const preBlock: React.CSSProperties = {
  margin: "8px 0 0",
  padding: 10,
  fontSize: 11,
  lineHeight: 1.45,
  background: "rgba(0, 4, 10, 0.85)",
  border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.06)",
  borderRadius: 4,
  overflowX: "auto",
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  color: "#99aabb",
  maxHeight: 320,
  overflowY: "auto",
};

const footerHint: React.CSSProperties = {
  padding: "8px 16px 10px",
  fontSize: 9,
  color: "#445566",
  borderTop: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.06)",
};

export function SubtaskInlineCard({
  entry,
  onInspect,
}: {
  entry: SubtaskEntry;
  onInspect?: (taskId: string) => void;
}) {
  const toolCalls = entry.toolCalls ?? [];
  const statusColor =
    entry.status === "running" ? CYAN : entry.status === "done" ? GREEN : entry.status === "error" ? RED : "#556677";
  const statusIcon =
    entry.status === "running" ? "⟳" : entry.status === "done" ? "✓" : entry.status === "error" ? "✗" : "⊘";
  const toolCount = toolCalls.length;
  const runningTools = toolCalls.filter((t) => t.status === "running").length;
  const hasOutput = (entry.finalOutput || entry.partialOutput || "").trim().length > 0;

  return (
    <button
      type="button"
      onClick={() => onInspect?.(entry.taskId)}
      style={{
        display: "block",
        width: "100%",
        textAlign: "left",
        cursor: onInspect ? "pointer" : "default",
        padding: "5px 11px",
        background: "rgba(0,5,14,0.7)",
        borderRadius: 3,
        fontSize: 12,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.1)",
        borderLeft: `2px solid ${statusColor}`,
        color: "#889aaa",
        marginLeft: entry.depth * 20,
      }}
      title={onInspect ? "Open sub-agent inspector" : undefined}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={{ color: MAGENTA }}>{"⤷".repeat(Math.max(1, entry.depth))}</span>
        <span style={{ color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
        <span style={{ color: "#334455", fontSize: 10 }}>{entry.taskId.slice(0, 8)}</span>
        <span style={{ color: "#99aabb", flex: 1, minWidth: 0 }}>
          {entry.goal.length > 120 ? entry.goal.slice(0, 119) + "…" : entry.goal}
        </span>
      </div>
      <div style={{ marginTop: 4, paddingLeft: 20, fontSize: 10, color: "#445566" }}>
        {toolCount > 0 ? (
          <span>
            {toolCount} tool{toolCount !== 1 ? "s" : ""}
            {runningTools > 0 ? ` · ${runningTools} running` : ""}
            {hasOutput ? " · text" : ""}
          </span>
        ) : entry.status === "running" ? (
          <span>Starting… click to inspect</span>
        ) : hasOutput ? (
          <span>Output ready · click to inspect</span>
        ) : (
          <span>No activity captured · click to inspect</span>
        )}
        {onInspect && <span style={{ color: CYAN, marginLeft: 8 }}>↗ inspect</span>}
      </div>
    </button>
  );
}
