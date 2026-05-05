import React, { useState, useRef, useEffect } from "react";
import { useSSE, type MessageEntry } from "./useSSE.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function ApprovalCountdown({
  receivedAt,
  approvalTimeoutMs,
}: {
  receivedAt: number;
  approvalTimeoutMs: number;
}) {
  const deadline = receivedAt + approvalTimeoutMs;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [receivedAt, approvalTimeoutMs]);
  const leftSec = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <div style={{ marginTop: 8, fontSize: 12, color: leftSec <= 10 ? "#ff8844" : "#888" }}>
      Auto-reject in {leftSec}s (timeout {Math.round(approvalTimeoutMs / 1000)}s)
    </div>
  );
}

export function App() {
  const { state, sendMessage, sendApproval, sendAnswer, sendClearSession } = useSSE();
  const [input, setInput] = useState("");
  const [askAnswer, setAskAnswer] = useState("");
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !state.busy) {
      await sendMessage(input.trim());
      setInput("");
    }
  };

  const pct = state.contextSnapshot
    ? Math.round(state.contextSnapshot.usageFraction * 100)
    : 0;

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTitle}>
          <span style={{ color: "#00d4ff", fontWeight: "bold" }}>Liminal</span>
          {state.personaName !== "Liminal" && (
            <span style={{ color: "#cc66ff", marginLeft: 6, fontSize: 13 }}>
              [{state.personaName}]
            </span>
          )}
          {state.busy && <span style={{ color: "#ffaa00", marginLeft: 8 }}>⟳</span>}
          {!state.connected && (
            <span style={{ color: "#ff4444", marginLeft: 8, fontSize: 12 }}>
              disconnected
            </span>
          )}
        </div>
        {state.contextSnapshot && (
          <div style={styles.contextBar}>
            <div
              style={{
                ...styles.contextFill,
                width: `${pct}%`,
                background: pct >= 80 ? "#ff4444" : pct >= 60 ? "#ffaa00" : "#44ff88",
              }}
            />
            <span style={{ color: pct >= 80 ? "#ff4444" : "#aaa", fontSize: 11 }}>
              {pct}% ctx{state.contextSnapshot.masked ? " [masked]" : ""}
            </span>
          </div>
        )}
        <button
          type="button"
          style={{
            ...styles.btn,
            background: "#333",
            marginLeft: 12,
            fontSize: 12,
            padding: "6px 10px",
          }}
          disabled={state.busy}
          title="Clear transcript; next message re-injects world context"
          onClick={() => void sendClearSession()}
        >
          New session
        </button>
        <button
          type="button"
          style={{
            ...styles.btn,
            background: showDiagnostics ? "#224466" : "#222",
            marginLeft: 8,
            fontSize: 12,
            padding: "6px 10px",
          }}
          onClick={() => setShowDiagnostics((v) => !v)}
          title="Toggle diagnostic trace/tool transcript lines"
        >
          {showDiagnostics ? "Diagnostics on" : "Diagnostics off"}
        </button>
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {state.messages.length === 0 && (
          <div style={{ color: "#555", textAlign: "center", marginTop: 40 }}>
            Start a conversation…
          </div>
        )}
        {state.messages
          .filter((entry) => {
            if (showDiagnostics) return true;
            return entry.kind === "user" || entry.kind === "assistant";
          })
          .map((entry, i) => (
          <MessageView key={i} entry={entry} />
          ))}
        {state.error && (
          <div style={{ color: "#ff4444", padding: "8px 0" }}>
            Error: {state.error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Tool approval modal */}
      {state.pendingApproval && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <div style={{ color: "#ff88ff", fontWeight: "bold", marginBottom: 8 }}>
              Tool Approval Required
            </div>
            <div style={{ marginBottom: 4 }}>
              Tool: <span style={{ color: "#00d4ff" }}>{state.pendingApproval.name}</span>
            </div>
            <pre style={styles.argsPreview}>
              {JSON.stringify(state.pendingApproval.args, null, 2).slice(0, 400)}
            </pre>
            <ApprovalCountdown
              receivedAt={state.pendingApproval.receivedAt}
              approvalTimeoutMs={state.pendingApproval.approvalTimeoutMs}
            />
            <div style={styles.modalButtons}>
              <button
                style={{ ...styles.btn, background: "#1a5c1a" }}
                onClick={() =>
                  sendApproval(state.pendingApproval!.callId, { decision: "approve" })
                }
              >
                Approve
              </button>
              <button
                style={{ ...styles.btn, background: "#5c1a1a" }}
                onClick={() =>
                  sendApproval(state.pendingApproval!.callId, {
                    decision: "reject",
                    reason: "Rejected by user",
                  })
                }
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Ask user modal */}
      {state.pendingAskUser && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <div style={{ color: "#4488ff", fontWeight: "bold", marginBottom: 8 }}>
              Agent Question
            </div>
            <div style={{ marginBottom: 12 }}>{state.pendingAskUser.prompt}</div>
            <input
              id="ask-user-answer"
              name="askUserAnswer"
              autoFocus
              style={styles.answerInput}
              value={askAnswer}
              onChange={(e) => setAskAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && askAnswer.trim()) {
                  sendAnswer(askAnswer.trim());
                  setAskAnswer("");
                }
              }}
              placeholder="Type your answer…"
            />
            <button
              style={{ ...styles.btn, background: "#1a3c5c", marginTop: 8 }}
              onClick={() => {
                if (askAnswer.trim()) {
                  sendAnswer(askAnswer.trim());
                  setAskAnswer("");
                }
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* Input */}
      <form style={styles.inputArea} onSubmit={handleSubmit}>
        <input
          id="chat-message-input"
          name="message"
          autoComplete="off"
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={state.busy ? "Processing…" : "Message Liminal…"}
          disabled={state.busy || !state.connected}
        />
        <button
          type="submit"
          style={{ ...styles.btn, background: state.busy ? "#333" : "#005580" }}
          disabled={state.busy || !input.trim()}
        >
          Send
        </button>
      </form>
    </div>
  );
}

function MessageView({ entry }: { entry: MessageEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <div style={styles.userMsg}>
          <span style={{ color: "#00d4ff", fontWeight: "bold" }}>You </span>
          <span>{entry.text}</span>
        </div>
      );

    case "assistant":
      return (
        <div style={styles.assistantMsg}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p style={styles.mdParagraph}>{children}</p>,
              ul: ({ children }) => <ul style={styles.mdList}>{children}</ul>,
              ol: ({ children }) => <ol style={styles.mdOrderedList}>{children}</ol>,
              li: ({ children }) => <li style={styles.mdListItem}>{children}</li>,
              h1: ({ children }) => <h1 style={styles.mdH1}>{children}</h1>,
              h2: ({ children }) => <h2 style={styles.mdH2}>{children}</h2>,
              h3: ({ children }) => <h3 style={styles.mdH3}>{children}</h3>,
              code: ({ className, children }) => (
                <code style={className ? styles.mdCodeBlock : styles.mdInlineCode}>{children}</code>
              ),
              pre: ({ children }) => <pre style={styles.mdPre}>{children}</pre>,
              blockquote: ({ children }) => <blockquote style={styles.mdQuote}>{children}</blockquote>,
              table: ({ children }) => (
                <div style={styles.mdTableWrap}>
                  <table style={styles.mdTable}>{children}</table>
                </div>
              ),
              th: ({ children }) => <th style={styles.mdTableHead}>{children}</th>,
              td: ({ children }) => <td style={styles.mdTableCell}>{children}</td>,
              hr: () => <hr style={styles.mdHr} />,
            }}
          >
            {entry.text}
          </ReactMarkdown>
          {entry.streaming && <span style={{ color: "#00d4ff" }}>█</span>}
        </div>
      );

    case "trace":
      return (
        <div style={styles.traceLine}>
          <span style={{ color: "#666", fontSize: 11 }}>[trace] </span>
          <span style={{ whiteSpace: "pre-wrap", color: "#777", fontSize: 12 }}>{entry.text}</span>
        </div>
      );

    case "provider_retry":
      return (
        <div style={styles.traceLine}>
          <span style={{ color: "#ffaa00", fontSize: 12 }}>{entry.text}</span>
        </div>
      );

    case "tool_call": {
      const statusColors: Record<string, string> = {
        streaming: "#ffaa00",
        pending_approval: "#ff88ff",
        done: "#44ff88",
        error: "#ff4444",
      };
      const statusLabels: Record<string, string> = {
        streaming: "⟳ forming",
        pending_approval: "⚠ approval needed",
        done: "✓ done",
        error: "✗ error",
      };
      const color = statusColors[entry.status] ?? "#aaa";
      return (
        <div style={styles.toolCard}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span style={{ color: "#00d4ff", fontWeight: "bold" }}>{entry.name}</span>
            <span style={{ color, fontSize: 12 }}>{statusLabels[entry.status]}</span>
          </div>
          {entry.argsJson && (
            <pre style={styles.toolArgs}>
              {entry.argsJson.slice(0, 200)}{entry.argsJson.length > 200 ? "…" : ""}
            </pre>
          )}
        </div>
      );
    }

    case "tool_result":
      return (
        <div style={{ ...styles.toolResult, color: entry.ok ? "#888" : "#ff4444" }}>
          → {entry.output.slice(0, 500)}{entry.output.length > 500 ? "…" : ""}
        </div>
      );

    case "think":
      return (
        <div style={styles.thinkBubble}>
          💭 {entry.content}
        </div>
      );

    case "plan":
      return (
        <div style={styles.planCard}>
          <div style={{ color: "#4488ff", fontWeight: "bold", marginBottom: 6 }}>Plan</div>
          {entry.steps.map((step, i) => {
            const done = step.startsWith("✓");
            return (
              <div key={i} style={{ color: done ? "#44aa66" : "#888", fontSize: 13, lineHeight: 1.6 }}>
                {`${i + 1}. ${done ? "✓" : "○"} ${done ? step.slice(2) : step}`}
              </div>
            );
          })}
        </div>
      );

    case "context_compressed":
      return (
        <div style={styles.contextCompressed}>
          ⊙ Context compressed: {entry.beforePct}% → {entry.afterPct}%
          {entry.rounds > 0 && ` (${entry.rounds} round(s) summarized)`}
        </div>
      );

    case "subtask": {
      const statusColor =
        entry.status === "running"
          ? "#ffaa00"
          : entry.status === "done"
          ? "#44ff88"
          : "#ff4444";
      const statusIcon =
        entry.status === "running" ? "⟳" : entry.status === "done" ? "✓" : "✗";
      return (
        <div
          style={{
            ...styles.subtaskCard,
            marginLeft: entry.depth * 16,
            borderLeft: `2px solid ${statusColor}`,
          }}
        >
          <span style={{ color: "#cc66ff" }}>{"⤷".repeat(Math.max(1, entry.depth))}</span>
          {" "}
          <span style={{ color: statusColor, fontWeight: "bold" }}>{statusIcon}</span>
          {" "}
          <span style={{ color: "#888", fontSize: 11 }}>{entry.taskId.slice(0, 8)}</span>
          {" "}
          <span>{entry.goal.slice(0, 100)}{entry.goal.length > 100 ? "…" : ""}</span>
        </div>
      );
    }
  }
}

const styles = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "#0d0d0d",
    color: "#e0e0e0",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    borderBottom: "1px solid #222",
    background: "#111",
    flexShrink: 0,
  },
  headerTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  contextBar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: 160,
  },
  contextFill: {
    height: 4,
    borderRadius: 2,
    transition: "width 0.3s ease",
    flex: 1,
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  userMsg: {
    padding: "6px 10px",
    background: "#1a1a2e",
    borderRadius: 6,
    borderLeft: "2px solid #00d4ff",
  },
  assistantMsg: {
    padding: "6px 10px",
    color: "#44dd88",
    lineHeight: 1.6,
  },
  mdParagraph: {
    margin: "0 0 10px",
    whiteSpace: "pre-wrap" as const,
  },
  mdList: {
    margin: "0 0 10px 20px",
  },
  mdOrderedList: {
    margin: "0 0 10px 20px",
  },
  mdListItem: {
    margin: "2px 0",
  },
  mdH1: {
    fontSize: 22,
    margin: "8px 0",
    color: "#7cf5a9",
  },
  mdH2: {
    fontSize: 19,
    margin: "8px 0",
    color: "#7cf5a9",
  },
  mdH3: {
    fontSize: 16,
    margin: "8px 0",
    color: "#7cf5a9",
  },
  mdInlineCode: {
    background: "#1a1f1a",
    border: "1px solid #2c3a2c",
    borderRadius: 4,
    padding: "1px 5px",
    color: "#9bf2b8",
  },
  mdPre: {
    margin: "10px 0",
    padding: "10px 12px",
    borderRadius: 6,
    background: "#101510",
    border: "1px solid #243024",
    overflowX: "auto" as const,
  },
  mdCodeBlock: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    color: "#9bf2b8",
  },
  mdQuote: {
    margin: "10px 0",
    padding: "4px 10px",
    borderLeft: "3px solid #2d6a4f",
    color: "#9acfb0",
  },
  mdTableWrap: {
    overflowX: "auto" as const,
    margin: "10px 0",
  },
  mdTable: {
    width: "100%",
    borderCollapse: "collapse" as const,
    border: "1px solid #2a2a2a",
  },
  mdTableHead: {
    textAlign: "left" as const,
    border: "1px solid #2a2a2a",
    padding: "6px 8px",
    background: "#161616",
  },
  mdTableCell: {
    border: "1px solid #2a2a2a",
    padding: "6px 8px",
    verticalAlign: "top" as const,
  },
  mdHr: {
    border: "none",
    borderTop: "1px solid #2d2d2d",
    margin: "10px 0",
  },
  toolCard: {
    border: "1px solid #333",
    borderRadius: 6,
    padding: "8px 12px",
    background: "#141414",
    fontFamily: "monospace",
  },
  toolArgs: {
    margin: "4px 0 0",
    color: "#666",
    fontSize: 12,
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
  },
  toolResult: {
    paddingLeft: 16,
    fontSize: 12,
    whiteSpace: "pre-wrap" as const,
    fontFamily: "monospace",
    lineHeight: 1.5,
  },
  inputArea: {
    display: "flex",
    gap: 8,
    padding: "12px 16px",
    borderTop: "1px solid #222",
    background: "#111",
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 6,
    color: "#e0e0e0",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
  },
  btn: {
    border: "none",
    borderRadius: 6,
    color: "#e0e0e0",
    padding: "8px 16px",
    fontSize: 14,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  modal: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.7)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modalBox: {
    background: "#1a1a1a",
    border: "1px solid #444",
    borderRadius: 8,
    padding: 24,
    width: 480,
    maxWidth: "90vw",
  },
  modalButtons: {
    display: "flex",
    gap: 12,
    marginTop: 12,
  },
  argsPreview: {
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    padding: 8,
    fontSize: 12,
    color: "#aaa",
    maxHeight: 160,
    overflow: "auto",
    whiteSpace: "pre-wrap" as const,
  },
  answerInput: {
    width: "100%",
    background: "#111",
    border: "1px solid #333",
    borderRadius: 4,
    color: "#e0e0e0",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
  },
  thinkBubble: {
    paddingLeft: 16,
    color: "#666",
    fontStyle: "italic",
    fontSize: 13,
    lineHeight: 1.5,
  },
  planCard: {
    border: "1px solid #2a3a5a",
    borderRadius: 6,
    padding: "8px 12px",
    background: "#0d1520",
    fontFamily: "monospace",
  },
  subtaskCard: {
    padding: "4px 10px",
    background: "#111",
    borderRadius: 4,
    fontSize: 13,
    fontFamily: "monospace",
    color: "#ccc",
  },
  contextCompressed: {
    paddingLeft: 16,
    color: "#666",
    fontSize: 12,
    fontStyle: "italic",
    lineHeight: 1.5,
  },
  traceLine: {
    paddingLeft: 12,
    borderLeft: "2px solid #333",
    lineHeight: 1.4,
  },
};
