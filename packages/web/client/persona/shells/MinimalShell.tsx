import React, { useRef, useEffect, useCallback, useMemo } from "react";
import type { ShellContract } from "../ShellContract.js";
import { migratePersonaUiTheme } from "@liminal/core/persona-ui-theme";
import type { MessageEntry } from "../../useSSE.js";
import { useStickyAutoScroll } from "../../useStickyAutoScroll.js";
import { ShellControls } from "./ShellControls.js";

// ── Palette ───────────────────────────────────────────────────────────────────

const CYAN    = "var(--lim-accent, #00d4ff)";
const AMBER   = "var(--lim-warn, #ffb347)";
const MAGENTA = "var(--lim-secondary, #ff4488)";
const GREEN   = "var(--lim-success, #00ff88)";
const RED_ERR = "var(--lim-danger, #ff2244)";

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
@keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }
*{box-sizing:border-box;scrollbar-width:thin;scrollbar-color:rgba(var(--lim-accent-rgb),.08) transparent}
::-webkit-scrollbar{width:3px}
::-webkit-scrollbar-thumb{background:rgba(var(--lim-accent-rgb),.1);border-radius:2px}
`;

// ── MinimalShell ──────────────────────────────────────────────────────────────

/** Single column, reduced chrome. */
export function MinimalShell({ contract }: { contract: ShellContract }) {
  const messagesRef = useRef<HTMLDivElement>(null);
  const bottomRef   = useRef<HTMLDivElement>(null);
  const inputRef    = useRef<HTMLTextAreaElement>(null);

  const personaTheme = useMemo(() => migratePersonaUiTheme(contract.personaTheme), [contract.personaTheme]);

  useStickyAutoScroll(messagesRef, bottomRef, contract.groupedMessages);

  // Textarea auto-height
  const syncTextareaHeight = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${Math.max(36, Math.min(el.scrollHeight, 200))}px`;
  }, []);

  useEffect(() => { syncTextareaHeight(); }, [contract.input, syncTextareaHeight]);

  const {
    groupedMessages, surface, showRawHarness, error,
    input, attachments, attachError, isDragOver, canSend, busy,
    onInputChange, onSubmit, onKeyDown, onPaste, onDragOver, onDragLeave, onDrop, onRemoveAttachment,
    signalHud,
  } = contract;

  const isDisconnected = signalHud.label === "OFFLINE" || signalHud.label === "DEGRADED";

  return (
    <>
      <style>{CSS}</style>

      {/* Outer flex column — max 680px centered */}
      <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", minHeight: 0, maxWidth: 680, margin: "0 auto", width: "100%" }}>

        {/* Required controls — keep settings reachable in every persona style */}
        <div style={{ flexShrink: 0, display: "flex", justifyContent: "flex-end", padding: "14px 24px 0" }}>
          <ShellControls contract={contract} tone="soft" />
        </div>

        {/* Messages area */}
        <div
          ref={messagesRef}
          style={{ flex: 1, overflowY: "auto", padding: "32px 24px 16px" }}
        >
          {groupedMessages.length === 0 && !busy && (
            <div style={{ color: "rgba(var(--lim-accent-rgb),0.15)", textAlign: "center", marginTop: 80, fontSize: 14 }}>
              …
            </div>
          )}

          {groupedMessages.map((entry, i) => {
            // Tool group — hidden in minimal
            if ("kind" in entry && entry.kind === "tool_group") {
              return null;
            }

            const m = entry as MessageEntry;

            // Tool calls are hidden
            if (m.kind === "tool_call" || m.kind === "tool_result") return null;

            // Raw lines hidden unless showRawHarness
            if (m.kind === "trace" || m.kind === "provider_retry" || m.kind === "context_compressed") {
              if (!showRawHarness) return null;
            }

            const prevEntry = groupedMessages[i - 1];
            const prevKind = prevEntry && "kind" in prevEntry ? prevEntry.kind : null;
            const showSeparator = i > 0 && prevKind !== null && (
              (m.kind === "user" && prevKind === "assistant") ||
              (m.kind === "assistant" && prevKind === "user")
            );

            return (
              <div key={i}>
                {showSeparator && (
                  <div style={{ height: 1, background: "rgba(var(--lim-accent-rgb),0.07)", margin: "18px 0" }} />
                )}

                {m.kind === "user" && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "rgba(var(--lim-accent-rgb),0.3)", fontFamily: "monospace", letterSpacing: "0.06em", marginBottom: 4 }}>you</div>
                    <div style={{ color: "var(--lim-text, #c8d4e0)", whiteSpace: "pre-wrap", lineHeight: 1.65, fontSize: 14 }}>{m.text}</div>
                  </div>
                )}

                {m.kind === "assistant" && (
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ color: "var(--lim-text, #c8d4e0)", lineHeight: 1.75, fontSize: 14, whiteSpace: "pre-wrap" }}>
                      {m.text}
                      {m.streaming && <span style={{ color: CYAN, animation: "blink 1s step-end infinite" }}>█</span>}
                    </div>
                  </div>
                )}

                {m.kind === "think" && (
                  <div style={{ marginBottom: 8, color: "#445566", fontSize: 12, fontStyle: "italic", lineHeight: 1.55 }}>
                    <span style={{ color: "#334455" }}>↳ </span>
                    {m.content.length > 500 ? m.content.slice(0, 499) + "…" : m.content}
                  </div>
                )}

                {m.kind === "model_reasoning" && (
                  <div style={{ marginBottom: 8, color: "#443322", fontSize: 12, fontStyle: "italic", lineHeight: 1.55 }}>
                    <span style={{ color: "#332211" }}>↳ </span>
                    {m.text.length > 500 ? m.text.slice(0, 499) + "…" : m.text}
                  </div>
                )}

                {m.kind === "plan" && (() => {
                  const steps = Array.isArray(m.steps) ? m.steps : [];
                  if (steps.length === 0) return null;
                  return (
                    <div style={{ marginBottom: 10, color: "#556677", fontSize: 13, lineHeight: 1.65 }}>
                      {steps.map((step, si) => {
                        const done = step.startsWith("✓");
                        const text = done ? step.slice(2) : step;
                        return (
                          <div key={si} style={{ color: done ? "#334455" : "#556677", opacity: done ? 0.5 : 1 }}>
                            {done ? "✓" : "○"} {si + 1}. {text}
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                {m.kind === "subtask" && (
                  <div style={{ fontSize: 12, color: "#445566", paddingLeft: m.depth * 12 }}>
                    {m.status === "done" ? "✓" : m.status === "error" ? "✗" : "→"} {m.goal.length > 70 ? m.goal.slice(0, 69) + "…" : m.goal}
                  </div>
                )}

                {m.kind === "pulse_nudge" && (
                  <div style={{ fontSize: 12, color: "#556677", fontStyle: "italic" }}>{m.text}</div>
                )}

                {m.kind === "trace" && showRawHarness && (
                  <div style={{ fontSize: 10, color: "#223344", fontFamily: "monospace" }}>{m.text}</div>
                )}

                {m.kind === "provider_retry" && showRawHarness && (
                  <div style={{ fontSize: 10, color: AMBER, fontFamily: "monospace" }}>{m.text}</div>
                )}

                {m.kind === "context_compressed" && showRawHarness && (
                  <div style={{ fontSize: 10, color: "#334455", fontFamily: "monospace" }}>⊙ compressed: {m.beforePct}% → {m.afterPct}%</div>
                )}
              </div>
            );
          })}

          {error && (
            <div style={{ marginTop: 12, color: RED_ERR, fontSize: 13 }}>✗ {error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area — borderless, full width */}
        <form
          style={{ flexShrink: 0, padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 6 }}
          onSubmit={onSubmit}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          {attachments.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
              {attachments.map((attachment, idx) => (
                <div key={`${attachment.name}-${idx}`} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#445566" }}>
                  <img src={attachment.dataUrl} alt={attachment.name} style={{ width: 18, height: 18, objectFit: "cover", borderRadius: 3 }} />
                  <span>{attachment.name}</span>
                  <button type="button" style={{ background: "none", border: "none", color: "#334455", cursor: "pointer", fontSize: 12, padding: "0 2px" }} onClick={() => onRemoveAttachment(idx)} disabled={busy}>×</button>
                </div>
              ))}
            </div>
          )}
          {attachError && <div style={{ color: RED_ERR, fontSize: 11 }}>{attachError}</div>}
          <div style={{ borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.12)" }}>
            <textarea
              ref={inputRef}
              rows={1}
              style={{ width: "100%", background: "transparent", border: "none", outline: "none", color: "var(--lim-text, #c8d4e0)", fontFamily: "var(--lim-font-body, system-ui, sans-serif)", fontSize: 14, resize: "none", minHeight: 36, maxHeight: 200, overflowY: "auto", lineHeight: 1.6, padding: "6px 0" }}
              value={input}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={e => void onKeyDown(e)}
              onPaste={e => void onPaste(e)}
              placeholder={busy ? "…" : "…"}
              disabled={busy}
            />
          </div>
        </form>

        {/* Disconnected/error status — single line at very bottom */}
        {isDisconnected && (
          <div style={{ flexShrink: 0, padding: "4px 24px 8px", textAlign: "center", fontSize: 10, color: RED_ERR, fontFamily: "monospace" }}>
            {signalHud.label.toLowerCase()}
            {signalHud.detail ? ` · ${signalHud.detail.slice(0, 60)}` : ""}
          </div>
        )}
      </div>
    </>
  );
}
