import React, { useRef, useMemo } from "react";
import { AssistantMessageContent, renderFencedCodeBlock } from "../../liminalMarkdown.js";
import { extractFencedCodeText } from "../../liminalMarkdownUtils.js";
import type { ShellContract, ToolCallEntry, ToolCallGroup } from "../ShellContract.js";
import { migratePersonaUiTheme } from "@liminal/core/persona-ui-theme";
import { categoryForTool } from "../categoryMeta.js";
import { ChatTurnThread, skipUserOrAssistantRow } from "../../ChatTurnThread.js";
import type { TurnRow } from "../../chatTurnLayout.js";
import { useStickyAutoScroll } from "../../useStickyAutoScroll.js";
import { ShellControls } from "./ShellControls.js";
import { ShellComposer } from "./ShellComposer.js";
import { ShellChatSwitcher } from "../../chat/ShellChatSwitcher.js";
import { LIM } from "../personaVars.js";
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
@keyframes data-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:rgba(var(--lim-accent-rgb),.1) transparent}
::-webkit-scrollbar{width:3px;height:3px}
::-webkit-scrollbar-thumb{background:rgba(var(--lim-accent-rgb),.14);border-radius:2px}
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
    for (const k of ["command", "path", "file_path", "query", "url", "key", "goal", "topic", "pid", "name"]) {
      const v = a[k];
      if (typeof v === "string" && v) {
        const flat = v.replace(/\n/g, " ");
        return flat.length > 60 ? flat.slice(0, 59) + "…" : flat;
      }
      if (typeof v === "number") return String(v);
    }
  } catch { /* ignore */ }
  return "";
}

// ── TerminalShell ─────────────────────────────────────────────────────────────

/** Full-width transcript, monospace-forward, scanline-friendly. */
export function TerminalShell({ contract }: { contract: ShellContract }) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);

  const personaTheme = useMemo(() => migratePersonaUiTheme(contract.personaTheme), [contract.personaTheme]);

  useStickyAutoScroll(messagesRef, bottomRef, contract.groupedMessages);

  const {
    chatTurns, toolResultMap, surface, showRawHarness, error,
    attachError, busy,
    signalHud, pct, personaDisplayLabel, onInspectSubtask,
  } = contract;

  const renderTerminalWorkingEntry = (entry: TurnRow, key: string) => {
    if ("kind" in entry && entry.kind === "tool_group") {
      const grp = entry as ToolCallGroup;
      const doneCount = grp.entries.filter((e) => e.status === "done").length;
      const errorCount = grp.entries.filter((e) => e.status === "error").length;
      const anyRun = grp.entries.some((e) => e.status === "running" || e.status === "streaming");
      const statusColor = errorCount > 0 ? RED_ERR : anyRun ? CYAN : GREEN;
      const statusIcon = errorCount > 0 ? "✗" : anyRun ? "⟳" : "✓";
      return (
        <div key={key} style={{ color: "rgba(var(--lim-accent-rgb),0.55)", fontSize: 11, lineHeight: 1.5 }}>
          <span style={{ color: statusColor }}>[{statusIcon}]</span>
          <span style={{ color: "#556677", marginLeft: 8 }}>{grp.name}</span>
          <span style={{ color: "#334455", marginLeft: 8 }}>× {grp.entries.length} parallel · {doneCount}/{grp.entries.length} done</span>
        </div>
      );
    }
    if (!skipUserOrAssistantRow(entry)) return null;
    const m = entry;

    switch (m.kind) {
      case "working_note":
        return (
          <div key={key} style={{ paddingLeft: 18, color: "#556677", fontSize: 11, fontStyle: "italic", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>
            {m.text}
          </div>
        );
      case "tool_call": {
        const tc = m as ToolCallEntry;
        const cat = categoryForTool(tc.name);
        const result = toolResultMap.get(tc.callId);
        const isActive = tc.status === "running" || tc.status === "streaming";
        const elapsed = tc.endedAt !== undefined ? tc.endedAt - tc.startedAt : Date.now() - tc.startedAt;
        const statusColor = tc.status === "error" ? RED_ERR : tc.status === "done" ? GREEN : tc.status === "pending_approval" ? MAGENTA : CYAN;
        const statusIcon = tc.status === "error" ? "✗" : tc.status === "done" ? "✓" : tc.status === "pending_approval" ? "⚠" : "⟳";
        const arg = parsePrimaryArg(tc.argsJson);
        return (
          <div key={key} style={{ color: "rgba(var(--lim-accent-rgb),0.55)", fontSize: 11, lineHeight: 1.5 }}>
            <span style={{ color: statusColor }}>[{statusIcon}]</span>
            <span style={{ color: cat.color, marginLeft: 8 }}>{cat.icon}</span>
            <span style={{ color: isActive ? "#8899aa" : "#556677", marginLeft: 6 }}>{tc.name}</span>
            {arg && <span style={{ color: "#334455", marginLeft: 8 }}>{arg}</span>}
            <span style={{ color: "#223344", marginLeft: 8 }}>{formatElapsed(elapsed)}</span>
            {result && !result.ok && <span style={{ color: RED_ERR, marginLeft: 8 }}>err</span>}
          </div>
        );
      }
      case "tool_result":
        return null;
      case "think":
        return (
          <div key={key} style={{ paddingLeft: 18, color: "#445566", fontSize: 11, fontStyle: "italic", lineHeight: 1.5, borderLeft: "1px solid rgba(var(--lim-accent-rgb),0.1)" }}>
            <span style={{ color: "#334455" }}>--- reasoning ---</span>
            <div style={{ marginTop: 2, color: "#3a4a5a" }}>{m.content.length > 600 ? m.content.slice(0, 599) + "…" : m.content}</div>
          </div>
        );
      case "model_reasoning":
        return (
          <div key={key} style={{ paddingLeft: 18, color: "#445566", fontSize: 11, fontStyle: "italic", lineHeight: 1.5, borderLeft: "1px solid rgba(var(--lim-warn-rgb),0.1)" }}>
            <span style={{ color: "#554433" }}>--- model reasoning ---</span>
            <div style={{ marginTop: 2, color: "#3a3028" }}>{m.text.length > 600 ? m.text.slice(0, 599) + "…" : m.text}</div>
          </div>
        );
      case "plan":
        return (
          <div key={key}>
            <PlanProgressBlock steps={Array.isArray(m.steps) ? m.steps : []} streaming={m.streaming} previewText={m.previewText} />
          </div>
        );
      case "subtask":
        return <SubtaskInlineCard key={key} entry={m} onInspect={onInspectSubtask} />;
      case "trace":
        if (!showRawHarness) return null;
        return <div key={key} style={{ color: "#223344", fontSize: 10, paddingLeft: 18 }}>[trace] {m.text}</div>;
      case "provider_retry":
        if (!showRawHarness) return null;
        return <div key={key} style={{ color: AMBER, fontSize: 10, paddingLeft: 18 }}>{m.text}</div>;
      case "context_compressed":
        if (!showRawHarness) return null;
        return <div key={key} style={{ color: "#334455", fontSize: 10, paddingLeft: 18 }}>⊙ context compressed: {m.beforePct}% → {m.afterPct}%</div>;
      case "pulse_nudge":
        return (
          <div key={key} style={{ color: "#445566", fontSize: 11, paddingLeft: 18 }}>
            <span style={{ color: MAGENTA }}>pulse</span> {m.text}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <>
      <style>{CSS}</style>

      {/* Full-height flex column */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0, fontFamily: "var(--lim-font-mono, Consolas, monospace)" }}>

        {/* Messages transcript */}
        <div
          ref={messagesRef}
          style={{ flex: 1, overflowY: "auto", padding: "16px 20px", display: "flex", flexDirection: "column", gap: 4 }}
        >
          {chatTurns.length === 0 && !busy && (
            <div style={{ color: "rgba(var(--lim-accent-rgb),0.18)", fontSize: 12, letterSpacing: "0.08em" }}>
              system ready. awaiting input_
            </div>
          )}

          <ChatTurnThread
            turns={chatTurns}
            renderUser={(m) => (
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10, marginBottom: 4 }}>
                <span style={{ color: CYAN, fontWeight: 700, flexShrink: 0, userSelect: "none" }}>&gt;</span>
                <span style={{ color: "var(--lim-text, #c8d4e0)", whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{m.text}</span>
              </div>
            )}
            renderFinalReply={(m) => (
              <div className="lim-md" style={{ color: "var(--lim-assistant, #00ff88)", lineHeight: 1.65, marginBottom: 4, paddingLeft: 18 }}>
                <AssistantMessageContent
                  text={m.text}
                  streaming={m.streaming}
                  components={{
                    p({ children }) { return <p style={{ margin: "0 0 6px", whiteSpace: "pre-wrap", lineHeight: 1.65 }}>{children}</p>; },
                    a({ href, children }) { return <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: CYAN, textDecoration: "none" }}>{children}</a>; },
                    h1({ children }) { return <h1 style={{ fontSize: 16, margin: "12px 0 6px", color: LIM.markdownH1, fontWeight: 700 }}>{children}</h1>; },
                    h2({ children }) { return <h2 style={{ fontSize: 14, margin: "10px 0 5px", color: LIM.markdownH2, fontWeight: 700 }}>{children}</h2>; },
                    h3({ children }) { return <h3 style={{ fontSize: 13, margin: "8px 0 4px", color: LIM.secondary, fontWeight: 600 }}>{children}</h3>; },
                    ul({ children }) { return <ul style={{ margin: "0 0 6px 18px", lineHeight: 1.6 }}>{children}</ul>; },
                    ol({ children }) { return <ol style={{ margin: "0 0 6px 18px", lineHeight: 1.6 }}>{children}</ol>; },
                    li({ children }) { return <li style={{ margin: "2px 0" }}>{children}</li>; },
                    pre({ children }) { return <div style={{ margin: "6px 0" }}>{children}</div>; },
                    code({ className, children }) {
                      const lang = /language-(\w+)/.exec(className ?? "")?.[1];
                      const raw = extractFencedCodeText(children);
                      if (lang) {
                        return renderFencedCodeBlock(className, children, { streaming: m.streaming, codeBg: LIM.codeBg });
                      }
                      if (raw.includes("\n")) {
                        return (
                          <div style={{ borderRadius: 3, margin: "6px 0", background: LIM.surface1, border: "1px solid rgba(var(--lim-accent-rgb),0.15)", padding: "8px 12px", fontFamily: "var(--lim-font-mono, monospace)", fontSize: 12, whiteSpace: "pre", overflowX: "auto" }}>
                            {raw}
                          </div>
                        );
                      }
                      return <code style={{ background: LIM.surface1, border: "1px solid rgba(var(--lim-accent-rgb),0.12)", borderRadius: 2, padding: "1px 4px", color: GREEN, fontFamily: "var(--lim-font-mono, monospace)", fontSize: "0.9em" }}>{children}</code>;
                    },
                    blockquote({ children }) { return <blockquote style={{ margin: "6px 0", paddingLeft: 10, borderLeft: "2px solid rgba(var(--lim-accent-rgb),0.3)", color: LIM.textDim, fontStyle: "italic" }}>{children}</blockquote>; },
                    table({ children }) { return <div style={{ overflowX: "auto", margin: "8px 0" }}><table style={{ width: "100%", borderCollapse: "collapse", background: LIM.surface1, fontSize: 12 }}>{children}</table></div>; },
                    th({ children }) { return <th style={{ textAlign: "left", border: "1px solid rgba(var(--lim-accent-rgb),0.15)", padding: "4px 8px", background: LIM.surface2, color: LIM.textMuted, fontWeight: 700, fontSize: 10 }}>{children}</th>; },
                    td({ children }) { return <td style={{ border: "1px solid rgba(var(--lim-accent-rgb),0.08)", padding: "4px 8px", color: LIM.textDim }}>{children}</td>; },
                    hr() { return <div style={{ margin: "10px 0", height: 1, background: "rgba(var(--lim-accent-rgb),0.15)" }} />; },
                    img({ src, alt }) {
                      if (!src) return null;
                      return <span style={{ display: "block", margin: "6px 0" }}><img src={src} alt={alt ?? ""} loading="lazy" style={{ maxWidth: "100%", borderRadius: 3, border: "1px solid rgba(var(--lim-accent-rgb),0.1)" }} /></span>;
                    },
                  }}
                />
                {m.streaming && <span style={{ color: CYAN, animation: "blink 1s step-end infinite" }}>_</span>}
              </div>
            )}
            renderWorkingEntry={renderTerminalWorkingEntry}
          />

          {error && <div style={{ color: RED_ERR, fontSize: 12, marginTop: 8 }}>✗ error: {error}</div>}
          <div ref={bottomRef} />
        </div>

        <ShellComposer contract={contract} personaTheme={personaTheme} variant="terminal" />

        {/* Status line at bottom */}
        <div style={{ flexShrink: 0, padding: "3px 12px 5px", background: "rgba(0,1,4,0.99)", borderTop: "1px solid rgba(var(--lim-accent-rgb),0.05)", display: "flex", alignItems: "center", gap: 10, fontSize: 9, fontFamily: "var(--lim-font-mono, Consolas, monospace)", letterSpacing: "0.08em", color: "rgba(var(--lim-accent-rgb),0.35)", minWidth: 0 }}>
          <ShellChatSwitcher />
          <span style={{ color: "rgba(var(--lim-accent-rgb),0.15)", flexShrink: 0 }}>|</span>
          <span style={{ color: CYAN, flexShrink: 0 }}>[{personaDisplayLabel}]</span>
          <span style={{ color: "rgba(var(--lim-accent-rgb),0.2)" }}>›</span>
          <span style={{ color: signalHud.color }}>{signalHud.label}</span>
          <span style={{ color: "rgba(var(--lim-accent-rgb),0.2)" }}>·</span>
          <span style={{ color: pct >= 80 ? RED_ERR : "rgba(var(--lim-accent-rgb),0.4)" }}>{pct}% CTX</span>
          {attachError && (
            <>
              <span style={{ color: "rgba(var(--lim-accent-rgb),0.2)" }}>·</span>
              <span style={{ color: RED_ERR }}>{attachError}</span>
            </>
          )}
          {/* Required controls — keep settings reachable in every persona style */}
          <ShellControls contract={contract} tone="mono" messagesRef={messagesRef} style={{ marginLeft: "auto" }} />
        </div>
      </div>
    </>
  );
}
