import React, { useState, useRef, useMemo } from "react";
import type { ShellContract, ToolCallEntry, ToolCallGroup, ToolResult, ToolSurface } from "../ShellContract.js";
import { AssistantMessageContent, renderFencedCodeBlock } from "../../liminalMarkdown.js";
import { migratePersonaUiTheme } from "@liminal/core/persona-ui-theme";
import { resolveToolCardsMode } from "../../resolveToolCardsMode.js";
import { useStickyAutoScroll } from "../../useStickyAutoScroll.js";
import { ShellControls } from "./ShellControls.js";
import { ShellComposer } from "./ShellComposer.js";
import { ShellChatSwitcher } from "../../chat/ShellChatSwitcher.js";
import { categoryForTool } from "../categoryMeta.js";
import { buildMessagesStyle, messageEntranceClass } from "../shellLayout.js";
import { LIM } from "../personaVars.js";
import type { MessageEntry } from "../../useSSE.js";
import { SubtaskInlineCard } from "../../SubtaskInspectorModal.js";
import { PlanProgressBlock } from "../../PlanProgressBlock.js";

// ── Palette ───────────────────────────────────────────────────────────────────

const CYAN    = "var(--lim-accent, #00d4ff)";
const AMBER   = "var(--lim-warn, #ffb347)";
const MAGENTA = "var(--lim-secondary, #ff4488)";
const GREEN   = "var(--lim-success, #00ff88)";
const RED_ERR = "var(--lim-danger, #ff2244)";

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
@keyframes blink      { 0%,100%{opacity:1} 50%{opacity:0} }
@keyframes studio-in  { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:translateY(0)} }
@keyframes drawer-in  { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:rgba(var(--lim-accent-rgb),.1) transparent}
::-webkit-scrollbar{width:4px}
::-webkit-scrollbar-thumb{background:rgba(var(--lim-accent-rgb),.12);border-radius:2px}
`;

// ── Utilities ─────────────────────────────────────────────────────────────────

function formatElapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function parsePrimaryArg(argsJson: string): string {
  if (!argsJson) return "";
  try {
    const a = JSON.parse(argsJson) as Record<string, unknown>;
    for (const k of ["command", "path", "file_path", "query", "url", "key", "goal", "topic", "name"]) {
      const v = a[k];
      if (typeof v === "string" && v) {
        const flat = v.replace(/\n/g, " ");
        return flat.length > 50 ? flat.slice(0, 49) + "…" : flat;
      }
    }
  } catch { /* ignore */ }
  return "";
}

// ── Tool activity drawer ──────────────────────────────────────────────────────

function ToolDrawer({
  toolCalls,
  toolResultMap,
  surface,
}: {
  toolCalls: ToolCallEntry[];
  toolResultMap: Map<string, ToolResult>;
  surface: ToolSurface;
}) {
  const recent = [...toolCalls].reverse().slice(0, 30);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>
      <div style={{ padding: "10px 14px 8px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.07)", flexShrink: 0 }}>
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: "rgba(var(--lim-accent-rgb),0.4)", fontFamily: "monospace" }}>TOOL ACTIVITY</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "6px 0" }}>
        {recent.length === 0 && (
          <div style={{ padding: "20px 14px", color: "rgba(var(--lim-accent-rgb),0.2)", fontSize: 11, textAlign: "center" }}>no activity yet</div>
        )}
        {recent.map((tc) => {
          const cat = categoryForTool(tc.name);
          const result = toolResultMap.get(tc.callId);
          const isActive = tc.status === "running" || tc.status === "streaming";
          const elapsed = tc.endedAt !== undefined ? tc.endedAt - tc.startedAt : Date.now() - tc.startedAt;
          const statusColor = tc.status === "error" ? RED_ERR : tc.status === "done" ? GREEN : tc.status === "pending_approval" ? MAGENTA : CYAN;
          const statusIcon  = tc.status === "error" ? "✗" : tc.status === "done" ? "✓" : tc.status === "pending_approval" ? "⚠" : "⟳";
          const arg = parsePrimaryArg(tc.argsJson);
          return (
            <div key={tc.callId} style={{ padding: "7px 14px", borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.04)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: cat.color, fontSize: 10, flexShrink: 0 }}>{cat.icon}</span>
                <span style={{ color: isActive ? "#aabbcc" : "#667788", fontSize: 11, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{tc.name}</span>
                <span style={{ color: statusColor, fontSize: 10, flexShrink: 0 }}>{statusIcon}</span>
                <span style={{ color: "#334455", fontSize: 9, fontFamily: "monospace", flexShrink: 0 }}>{formatElapsed(elapsed)}</span>
              </div>
              {arg && <div style={{ fontSize: 10, color: "#445566", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", paddingLeft: 16 }}>{arg}</div>}
              {result && !result.ok && (
                <div style={{ fontSize: 10, color: RED_ERR, marginTop: 3, paddingLeft: 16, whiteSpace: "pre-wrap" }}>
                  {result.output.slice(0, 120)}{result.output.length > 120 ? "…" : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── StudioShell ───────────────────────────────────────────────────────────────

/** Softer panels, rounded cards, bubble messages. */
export function StudioShell({ contract }: { contract: ShellContract }) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const personaTheme = useMemo(() => migratePersonaUiTheme(contract.personaTheme), [contract.personaTheme]);
  const entrance = messageEntranceClass(personaTheme.messageEntrance);

  useStickyAutoScroll(messagesRef, bottomRef, contract.groupedMessages);

  const {
    groupedMessages, toolResultMap, surface, showRawHarness, rawHarnessBlob, error,
    busy, allToolCalls, personaDisplayLabel, personaName, showPanels, signalHud, onInspectSubtask,
  } = contract;

  const activeCount = allToolCalls.filter(t => t.status === "running" || t.status === "streaming" || t.status === "pending_approval").length;
  const toolCardsMode = resolveToolCardsMode(personaTheme.toolCards, surface);

  // Determine whether to show drawer panel (based on panelLayout)
  const panelLayout = personaTheme.panelLayout ?? "right";
  const showDrawerPanel = showPanels && (panelLayout === "right" || panelLayout === "both");

  return (
    <>
      <style>{CSS}</style>

      {/* Top chrome: chat (left) · persona pill (center) · controls (right) */}
      <div
        style={{
          flexShrink: 0,
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
          alignItems: "center",
          gap: 10,
          padding: "8px 12px 0",
        }}
      >
        <div style={{ justifySelf: "start", minWidth: 0, overflow: "hidden" }}>
          <ShellChatSwitcher />
        </div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 14px",
            borderRadius: 24,
            background: "rgba(10,16,28,0.88)",
            border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
            backdropFilter: "blur(8px)",
          }}
        >
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: signalHud.color, boxShadow: `0 0 5px ${signalHud.color}` }} />
          <span style={{ color: "var(--lim-text, #c8d4e0)", fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" }}>{personaDisplayLabel}</span>
          {signalHud.label !== "ONLINE" && (
            <span style={{ color: signalHud.color, fontSize: 9, fontFamily: "monospace", opacity: 0.8 }}>{signalHud.label}</span>
          )}
        </div>
        <div style={{ justifySelf: "end" }}>
          <ShellControls contract={contract} tone="soft" messagesRef={messagesRef} />
        </div>
      </div>

      {/* Main body: center column + optional right drawer */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden", minHeight: 0, position: "relative" }}>

        {/* Center content column */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0 }}>

          {/* Messages */}
          <div
            ref={messagesRef}
            style={{ flex: 1, overflowY: "auto", padding: "20px 0", display: "flex", flexDirection: "column", gap: 10 }}
          >
            <div style={{ maxWidth: 720, width: "100%", margin: "0 auto", padding: "0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
              {groupedMessages.length === 0 && !busy && (
                <div style={{ color: "rgba(var(--lim-accent-rgb),0.18)", textAlign: "center", marginTop: 60, fontSize: 14 }}>
                  Start a conversation…
                </div>
              )}

              {groupedMessages.map((entry, i) => {
                // Tool group
                if ("kind" in entry && entry.kind === "tool_group") {
                  const grp = entry as ToolCallGroup;
                  const doneCount  = grp.entries.filter(e => e.status === "done").length;
                  const errorCount = grp.entries.filter(e => e.status === "error").length;
                  const anyRun     = grp.entries.some(e => e.status === "running" || e.status === "streaming");
                  const statusColor = errorCount > 0 ? RED_ERR : anyRun ? CYAN : GREEN;
                  const statusIcon  = errorCount > 0 ? "✗" : anyRun ? "⟳" : "✓";
                  return (
                    <div key={`grp-${i}`} className={entrance || undefined} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 12px", borderRadius: 8, background: "rgba(var(--lim-accent-rgb),0.04)", border: "1px solid rgba(var(--lim-accent-rgb),0.08)", fontSize: 11, fontFamily: "monospace" }}>
                      <span style={{ color: statusColor }}>{statusIcon}</span>
                      <span style={{ color: "#667788" }}>{grp.name}</span>
                      <span style={{ color: "#334455" }}>× {grp.entries.length}</span>
                      <span style={{ color: "#334455" }}>· {doneCount}/{grp.entries.length} done</span>
                    </div>
                  );
                }

                const m = entry as MessageEntry;

                switch (m.kind) {
                  case "user":
                    return (
                      <div key={i} className={entrance || undefined} style={{ animation: "studio-in 0.22s ease", display: "flex", justifyContent: "flex-end" }}>
                        <div style={{ maxWidth: "80%", padding: "10px 16px", borderRadius: 16, background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.09)", color: "var(--lim-text, #c8d4e0)", lineHeight: 1.6, fontSize: 14, whiteSpace: "pre-wrap" }}>
                          {m.text}
                        </div>
                      </div>
                    );

                  case "assistant":
                    return (
                      <div key={i} className={entrance || undefined} style={{ animation: "studio-in 0.22s ease", display: "flex", justifyContent: "flex-start", alignItems: "flex-start", gap: 10 }}>
                        <div style={{ width: 28, height: 28, borderRadius: "50%", background: `rgba(var(--lim-accent-rgb),0.1)`, border: `1px solid rgba(var(--lim-accent-rgb),0.2)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                          <span style={{ color: CYAN, fontSize: 10 }}>❯</span>
                        </div>
                        <div className="lim-md" style={{ flex: 1, minWidth: 0, color: "var(--lim-assistant, #00ff88)", lineHeight: 1.7, fontSize: 14 }}>
                          <AssistantMessageContent
                            text={m.text}
                            streaming={m.streaming}
                            components={{
                              p({ children }) { return <p style={{ margin: "0 0 10px", lineHeight: 1.72 }}>{children}</p>; },
                              a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: CYAN, textDecoration: "none", borderBottom: "1px dotted rgba(var(--lim-accent-rgb),0.3)" }}>{children}</a>; },
                              h1({ children }) { return <h1 style={{ fontSize: 20, margin: "16px 0 8px", color: LIM.markdownH1, fontWeight: 700 }}>{children}</h1>; },
                              h2({ children }) { return <h2 style={{ fontSize: 17, margin: "14px 0 7px", color: LIM.markdownH2, fontWeight: 700 }}>{children}</h2>; },
                              h3({ children }) { return <h3 style={{ fontSize: 14, margin: "12px 0 6px", color: LIM.secondary, fontWeight: 600 }}>{children}</h3>; },
                              ul({ children }) { return <ul style={{ margin: "0 0 10px 20px", lineHeight: 1.7 }}>{children}</ul>; },
                              ol({ children }) { return <ol style={{ margin: "0 0 10px 20px", lineHeight: 1.7 }}>{children}</ol>; },
                              li({ children }) { return <li style={{ margin: "3px 0" }}>{children}</li>; },
                              pre({ children }) { return <div style={{ margin: "10px 0" }}>{children}</div>; },
                              code({ className, children }) {
                                return renderFencedCodeBlock(className, children, {
                                  streaming: m.streaming,
                                  codeBg: LIM.codeBg,
                                  inlineCodeStyle: {
                                    background: LIM.surface1,
                                    border: "1px solid rgba(var(--lim-accent-rgb),0.12)",
                                    borderRadius: 4,
                                    padding: "1px 5px",
                                    color: GREEN,
                                    fontFamily: "monospace",
                                    fontSize: "0.9em",
                                  },
                                });
                              },
                              blockquote({ children }) {
                                return <blockquote style={{ margin: "12px 0", padding: "8px 14px", borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.25)", color: LIM.textDim, fontStyle: "italic", background: LIM.surface1, borderRadius: "0 8px 8px 0" }}>{children}</blockquote>;
                              },
                              table({ children }) { return <div style={{ overflowX: "auto", margin: "12px 0" }}><table style={{ width: "100%", borderCollapse: "collapse", background: LIM.surface1 }}>{children}</table></div>; },
                              th({ children }) { return <th style={{ textAlign: "left", border: "1px solid rgba(var(--lim-accent-rgb),0.1)", padding: "7px 12px", background: LIM.surface2, color: LIM.textMuted, fontWeight: 700, fontSize: 11 }}>{children}</th>; },
                              td({ children }) { return <td style={{ border: "1px solid rgba(var(--lim-accent-rgb),0.07)", padding: "6px 12px", verticalAlign: "top", color: LIM.textDim }}>{children}</td>; },
                              hr() { return <div style={{ margin: "16px 0", height: 1, background: "linear-gradient(90deg, transparent, rgba(var(--lim-accent-rgb),0.15), rgba(var(--lim-success-rgb),0.2), rgba(var(--lim-accent-rgb),0.15), transparent)" }} />; },
                            }}
                          />
                          {m.streaming && <span style={{ color: CYAN, animation: "blink 1s step-end infinite" }}>█</span>}
                        </div>
                      </div>
                    );

                  case "tool_call": {
                    const tc = m as ToolCallEntry;
                    if (toolCardsMode === "hidden") return null;
                    const cat = categoryForTool(tc.name);
                    const isActive = tc.status === "running" || tc.status === "streaming";
                    const statusColor = tc.status === "error" ? RED_ERR : tc.status === "done" ? GREEN : tc.status === "pending_approval" ? MAGENTA : CYAN;
                    const statusIcon  = tc.status === "error" ? "✗" : tc.status === "done" ? "✓" : tc.status === "pending_approval" ? "⚠" : "⟳";
                    const arg = parsePrimaryArg(tc.argsJson);
                    return (
                      <div key={i} style={{ padding: "6px 12px", borderRadius: 8, background: "rgba(var(--lim-accent-rgb),0.03)", border: "1px solid rgba(var(--lim-accent-rgb),0.07)", fontSize: 11, fontFamily: "monospace", display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ color: cat.color }}>{cat.icon}</span>
                        <span style={{ color: isActive ? "#aabbcc" : "#556677" }}>{tc.name}</span>
                        {arg && <span style={{ color: "#334455", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>{arg}</span>}
                        <span style={{ color: statusColor, flexShrink: 0 }}>{statusIcon}</span>
                        {isActive && <span style={{ color: CYAN, fontSize: 9 }}>…</span>}
                      </div>
                    );
                  }

                  case "tool_result":
                    return null;

                  case "think":
                    return (
                      <div key={i} style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(0,4,12,0.45)", border: "1px solid rgba(var(--lim-accent-rgb),0.06)", color: "#556677", fontSize: 12, fontStyle: "italic", lineHeight: 1.6 }}>
                        <div style={{ color: "#334455", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>◈ REASONING</div>
                        {m.content.length > 800 ? m.content.slice(0, 799) + "…" : m.content}
                      </div>
                    );

                  case "model_reasoning":
                    return (
                      <div key={i} style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(0,4,12,0.45)", border: "1px solid rgba(var(--lim-warn-rgb),0.08)", color: "#554433", fontSize: 12, fontStyle: "italic", lineHeight: 1.6 }}>
                        <div style={{ color: "#443322", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", marginBottom: 4 }}>◈ MODEL REASONING</div>
                        {m.text.length > 800 ? m.text.slice(0, 799) + "…" : m.text}
                      </div>
                    );

                  case "plan":
                    return (
                      <div key={i}>
                        <PlanProgressBlock
                          steps={Array.isArray(m.steps) ? m.steps : []}
                          streaming={m.streaming}
                          previewText={m.previewText}
                        />
                      </div>
                    );

                  case "subtask":
                    return (
                      <SubtaskInlineCard key={i} entry={m} onInspect={onInspectSubtask} />
                    );

                  case "trace":
                    if (!showRawHarness) return null;
                    return <div key={i} style={{ fontSize: 10, color: "#223344", fontFamily: "monospace" }}>[trace] {m.text}</div>;

                  case "provider_retry":
                    if (!showRawHarness) return null;
                    return <div key={i} style={{ fontSize: 10, color: AMBER, fontFamily: "monospace" }}>{m.text}</div>;

                  case "context_compressed":
                    if (!showRawHarness) return null;
                    return <div key={i} style={{ fontSize: 10, color: "#334455", fontFamily: "monospace" }}>⊙ context compressed: {m.beforePct}% → {m.afterPct}%</div>;

                  case "pulse_nudge":
                    return (
                      <div key={i} style={{ padding: "8px 14px", borderRadius: 8, background: "rgba(var(--lim-secondary-rgb),0.04)", border: "1px solid rgba(var(--lim-secondary-rgb),0.07)", fontSize: 12, color: "#778899" }}>
                        <span style={{ color: MAGENTA, marginRight: 6, fontSize: 10 }}>PULSE</span>
                        {m.text}
                      </div>
                    );

                  default:
                    return null;
                }
              })}

              {error && (
                <div style={{ padding: "10px 16px", borderRadius: 10, background: "rgba(var(--lim-danger-rgb),0.05)", border: "1px solid rgba(var(--lim-danger-rgb),0.15)", color: RED_ERR, fontSize: 13 }}>
                  ✗ {error}
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          </div>

          <ShellComposer contract={contract} personaTheme={personaTheme} variant="studio" />
        </div>

        {/* Tool activity drawer (right side) */}
        {showDrawerPanel && drawerOpen && (
          <div style={{ width: 280, flexShrink: 0, borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.08)", background: "rgba(8,14,24,0.96)", animation: "drawer-in 0.2s ease", display: "flex", flexDirection: "column" }}>
            <ToolDrawer toolCalls={allToolCalls as ToolCallEntry[]} toolResultMap={toolResultMap} surface={surface} />
          </div>
        )}

        {/* Floating tool drawer toggle button */}
        <button
          type="button"
          onClick={() => setDrawerOpen(v => !v)}
          style={{
            position: "absolute", bottom: 90, right: showDrawerPanel && drawerOpen ? 288 : 16,
            background: activeCount > 0 ? "rgba(var(--lim-accent-rgb),0.12)" : "rgba(10,16,28,0.9)",
            border: `1px solid rgba(var(--lim-accent-rgb),${activeCount > 0 ? "0.3" : "0.12"})`,
            borderRadius: 20,
            color: activeCount > 0 ? CYAN : "rgba(var(--lim-accent-rgb),0.4)",
            padding: "6px 14px",
            fontSize: 11,
            cursor: "pointer",
            fontFamily: "monospace",
            letterSpacing: "0.06em",
            transition: "right 0.2s ease, border-color 0.2s",
            zIndex: 10,
          }}
        >
          ⚙{activeCount > 0 ? ` ${activeCount}` : ""}
        </button>
      </div>
    </>
  );
}
