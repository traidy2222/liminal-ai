import React, { useState, useRef, useEffect } from "react";
import { useSSE, type MessageEntry } from "./useSSE.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveInputShortcut } from "./inputSemantics.js";
import {
  DEFAULT_IMAGE_ATTACHMENT_LIMITS,
  normalizeImageAttachmentName,
  parseDataUrlImage,
  validateImageAttachments,
  type ImageAttachment,
} from "./imageAttachments.js";

// ── Tool category helpers ────────────────────────────────────────────────────

type ToolCategory =
  | "shell" | "file" | "web" | "memory" | "vault" | "code"
  | "git" | "markets" | "vision" | "docs" | "orchestration" | "context" | "other";

function getToolCategory(name: string): ToolCategory {
  if (/^(run_shell|run_background|kill_process|list_processes|read_process_output)$/.test(name)) return "shell";
  if (/^(read_file|write_file|list_dir|apply_diff|patch_file)$/.test(name)) return "file";
  if (/^(web_fetch|web_search|web_research|weather_lookup)$/.test(name)) return "web";
  if (/^(remember|recall|recall_type|recall_relevant|search_memory|forget|forget_type|memory_stats|memory_consolidate|memory_query|memory_graph)$/.test(name)) return "memory";
  if (name.startsWith("vault_")) return "vault";
  if (/^(ast_grep|symbol_index|find_references|run_tests|run_lint|execute_code|repo_map)$/.test(name)) return "code";
  if (name.startsWith("git_")) return "git";
  if (name.startsWith("markets_")) return "markets";
  if (/^(vision_analyze|upload_image)$/.test(name)) return "vision";
  if (name.startsWith("doc_")) return "docs";
  if (/^(spawn_agent|wait_for_agents|cancel_agent|list_agents|verify_result)$/.test(name)) return "orchestration";
  if (/^(check_context|compress_context)$/.test(name)) return "context";
  return "other";
}

const CATEGORY_META: Record<ToolCategory, { icon: string; color: string }> = {
  shell:         { icon: "▶", color: "#ff6655" },
  file:          { icon: "◇", color: "#4499ff" },
  web:           { icon: "◎", color: "#cc77ff" },
  memory:        { icon: "◈", color: "#ffbb33" },
  vault:         { icon: "⊚", color: "#33ccaa" },
  code:          { icon: "◆", color: "#44ee88" },
  git:           { icon: "⌥", color: "#ffaa44" },
  markets:       { icon: "◉", color: "#ffe033" },
  vision:        { icon: "◑", color: "#ff88cc" },
  docs:          { icon: "▣", color: "#8899ff" },
  orchestration: { icon: "⟴", color: "#ff55bb" },
  context:       { icon: "⊙", color: "#778899" },
  other:         { icon: "⚙", color: "#aaaaaa" },
};

const STATUS_META: Record<string, { icon: string; label: string; color: string }> = {
  streaming:        { icon: "…",  label: "forming",          color: "#ffaa33" },
  pending_approval: { icon: "⚠",  label: "approval needed",  color: "#ff66ff" },
  running:          { icon: "⟳",  label: "running",          color: "#33ddff" },
  done:             { icon: "✓",  label: "done",             color: "#44ff88" },
  error:            { icon: "✗",  label: "failed",           color: "#ff4444" },
};

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
    for (const k of ["command", "path", "file_path", "query", "url", "key", "goal", "topic", "pid", "task_id", "ticker", "symbol", "name"]) {
      const v = a[k];
      if (typeof v === "string" && v) {
        const flat = v.replace(/\n/g, "↩");
        return `${k}: ${flat.length > 70 ? flat.slice(0, 69) + "…" : flat}`;
      }
      if (typeof v === "number") return `${k}: ${v}`;
    }
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "string" && v.length > 0 && v.length < 120) {
        const flat = v.replace(/\n/g, "↩");
        return `${k}: ${flat.length > 70 ? flat.slice(0, 69) + "…" : flat}`;
      }
    }
  } catch { /* ignore */ }
  return "";
}

function truncateOutput(text: string, maxLines = 12, maxLineLen = 200): string {
  const lines = text.split("\n");
  const shown = lines
    .slice(0, maxLines)
    .map((l) => (l.length > maxLineLen ? l.slice(0, maxLineLen - 1) + "…" : l));
  if (lines.length > maxLines) {
    shown.push(`… ${lines.length - maxLines} more line${lines.length - maxLines !== 1 ? "s" : ""}`);
  }
  return shown.join("\n");
}

// ── Elapsed timer hook ───────────────────────────────────────────────────────

function useElapsedMs(startedAt: number, active: boolean): number {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setTick((n) => n + 1), 250);
    return () => window.clearInterval(id);
  }, [active, startedAt]);
  return Date.now() - startedAt;
}

// ── Approval countdown ───────────────────────────────────────────────────────

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
    <div style={{ fontSize: 12, color: leftSec <= 10 ? "#ff6644" : "#666" }}>
      Auto-reject in {leftSec}s
    </div>
  );
}

// ── Tool card ────────────────────────────────────────────────────────────────

type ToolCallEntry = Extract<MessageEntry, { kind: "tool_call" }>;

function ToolCard({ entry }: { entry: ToolCallEntry }) {
  const isActive =
    entry.status === "streaming" ||
    entry.status === "running" ||
    entry.status === "pending_approval";
  const elapsedMs = useElapsedMs(entry.startedAt, isActive);
  const displayMs = isActive
    ? elapsedMs
    : entry.endedAt !== undefined
    ? entry.endedAt - entry.startedAt
    : null;

  const cat = CATEGORY_META[getToolCategory(entry.name)];
  const sm = STATUS_META[entry.status] ?? STATUS_META["done"]!;
  const arg = parsePrimaryArg(entry.argsJson);

  return (
    <div
      style={{
        ...styles.toolCard,
        borderLeftColor: sm.color,
        borderLeftWidth: 3,
        borderLeftStyle: "solid",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {/* Left: category icon + name + primary arg */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
          <span style={{ color: cat.color, fontSize: 14, flexShrink: 0 }}>{cat.icon}</span>
          <span style={{ color: "#dde", fontWeight: 700, flexShrink: 0 }}>{entry.name}</span>
          {arg && (
            <span
              style={{
                color: "#666",
                fontSize: 12,
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {arg}
            </span>
          )}
        </div>
        {/* Right: elapsed + status badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {displayMs !== null && (
            <span style={{ color: "#555", fontSize: 11 }}>{formatElapsed(displayMs)}</span>
          )}
          <span
            style={{
              color: sm.color,
              fontSize: 11,
              fontWeight: 700,
              background: `${sm.color}18`,
              border: `1px solid ${sm.color}44`,
              borderRadius: 4,
              padding: "1px 7px",
              letterSpacing: "0.02em",
            }}
          >
            {sm.icon} {sm.label}
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Tool result ──────────────────────────────────────────────────────────────

type ToolResultEntry = Extract<MessageEntry, { kind: "tool_result" }>;

function ToolResultView({ entry }: { entry: ToolResultEntry }) {
  if (!entry.output.trim()) return null;
  const truncated = truncateOutput(entry.output);
  return (
    <div style={styles.toolResultWrap}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: entry.ok ? "#44ff88" : "#ff4444",
            letterSpacing: "0.05em",
            textTransform: "uppercase" as const,
          }}
        >
          {entry.ok ? "✓ output" : "✗ error"}
        </span>
      </div>
      <pre style={{ ...styles.toolOutputPre, color: entry.ok ? "#888" : "#ff7766" }}>
        {truncated}
      </pre>
    </div>
  );
}

// ── Subtask card ─────────────────────────────────────────────────────────────

type SubtaskEntry = Extract<MessageEntry, { kind: "subtask" }>;

function SubtaskView({ entry }: { entry: SubtaskEntry }) {
  const statusColor =
    entry.status === "running"  ? "#33ddff" :
    entry.status === "done"     ? "#44ff88" :
    entry.status === "error"    ? "#ff4444" : "#778899";

  const statusIcon =
    entry.status === "running"  ? "⟳" :
    entry.status === "done"     ? "✓" :
    entry.status === "error"    ? "✗" : "⊘";

  const outputLines =
    entry.status === "running" && entry.partialOutput
      ? entry.partialOutput
          .trimEnd()
          .split("\n")
          .filter((l) => l.trim().length > 0)
          .slice(-4)
      : [];

  return (
    <div
      style={{
        ...styles.subtaskCard,
        marginLeft: entry.depth * 20,
        borderLeftColor: statusColor,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: "#cc66ff" }}>{"⤷".repeat(Math.max(1, entry.depth))}</span>
        <span style={{ color: statusColor, fontWeight: 700 }}>{statusIcon}</span>
        <span style={{ color: "#555", fontSize: 11, fontFamily: "monospace" }}>
          {entry.taskId.slice(0, 8)}
        </span>
        <span style={{ color: "#bbb" }}>
          {entry.goal.length > 120 ? entry.goal.slice(0, 119) + "…" : entry.goal}
        </span>
      </div>
      {outputLines.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 20 }}>
          {outputLines.map((line, i) => (
            <div key={i} style={{ color: "#556", fontSize: 11, fontFamily: "monospace", lineHeight: 1.4 }}>
              {line.length > 160 ? line.slice(0, 159) + "…" : line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main message view ────────────────────────────────────────────────────────

function MessageView({ entry }: { entry: MessageEntry }) {
  switch (entry.kind) {
    case "user":
      return (
        <div style={styles.userMsg}>
          <span style={{ color: "#33ccff", fontWeight: 700 }}>You </span>
          <span style={{ whiteSpace: "pre-wrap" }}>{entry.text}</span>
        </div>
      );

    case "assistant":
      return (
        <div style={styles.assistantMsg}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              p:          ({ children }) => <p style={styles.mdParagraph}>{children}</p>,
              ul:         ({ children }) => <ul style={styles.mdList}>{children}</ul>,
              ol:         ({ children }) => <ol style={styles.mdOrderedList}>{children}</ol>,
              li:         ({ children }) => <li style={styles.mdListItem}>{children}</li>,
              h1:         ({ children }) => <h1 style={styles.mdH1}>{children}</h1>,
              h2:         ({ children }) => <h2 style={styles.mdH2}>{children}</h2>,
              h3:         ({ children }) => <h3 style={styles.mdH3}>{children}</h3>,
              code:       ({ className, children }) => (
                <code style={className ? styles.mdCodeBlock : styles.mdInlineCode}>{children}</code>
              ),
              pre:        ({ children }) => <pre style={styles.mdPre}>{children}</pre>,
              blockquote: ({ children }) => <blockquote style={styles.mdQuote}>{children}</blockquote>,
              table:      ({ children }) => (
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
          {entry.streaming && <span style={{ color: "#33ccff" }}>█</span>}
        </div>
      );

    case "trace":
      return (
        <div style={styles.traceLine}>
          <span style={{ color: "#445", fontSize: 10, fontWeight: 700, marginRight: 6 }}>[trace]</span>
          <span style={{ whiteSpace: "pre-wrap", color: "#556", fontSize: 11 }}>{entry.text}</span>
        </div>
      );

    case "provider_retry":
      return (
        <div style={styles.traceLine}>
          <span style={{ color: "#886622", fontSize: 12 }}>{entry.text}</span>
        </div>
      );

    case "tool_call":
      return <ToolCard entry={entry} />;

    case "tool_result":
      return <ToolResultView entry={entry} />;

    case "think":
      return (
        <div style={styles.thinkBubble}>
          <div style={{ color: "#556677", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 4 }}>
            ◈ THINKING
          </div>
          <div style={{ color: "#668", fontStyle: "italic", whiteSpace: "pre-wrap", lineHeight: 1.55, fontSize: 13 }}>
            {entry.content.length > 1200 ? entry.content.slice(0, 1200) + "…" : entry.content}
          </div>
        </div>
      );

    case "plan": {
      const steps = Array.isArray(entry.steps) ? entry.steps : [];
      if (steps.length === 0) return null;
      return (
        <div style={styles.planCard}>
          <div style={{ color: "#5599ff", fontWeight: 700, marginBottom: 8, fontSize: 13 }}>
            ▸ Plan
          </div>
          {steps.map((step, i) => {
            const done = step.startsWith("✓");
            const text = done ? step.slice(2) : step;
            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-start",
                  color: done ? "#44aa66" : "#99aabb",
                  fontSize: 13,
                  lineHeight: 1.6,
                  paddingLeft: 4,
                }}
              >
                <span style={{ flexShrink: 0, color: done ? "#44aa66" : "#445" }}>
                  {done ? "✓" : "○"}
                </span>
                <span style={{ textDecoration: done ? "line-through" : "none", opacity: done ? 0.7 : 1 }}>
                  {i + 1}. {text}
                </span>
              </div>
            );
          })}
        </div>
      );
    }

    case "subtask":
      return <SubtaskView entry={entry} />;

    case "context_compressed":
      return (
        <div style={styles.contextCompressed}>
          ⊙ Context compressed: {entry.beforePct}% → {entry.afterPct}%
          {entry.rounds > 0 && ` (${entry.rounds} round${entry.rounds !== 1 ? "s" : ""} summarised)`}
        </div>
      );

    default:
      return null;
  }
}

// ── File attachment helper ───────────────────────────────────────────────────

async function fileToDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });
}

// ── Main App ─────────────────────────────────────────────────────────────────

export function App() {
  const { state, sendMessage, sendApproval, sendAnswer, sendClearSession } = useSSE();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [askAnswer, setAskAnswer] = useState("");
  const [showTrace, setShowTrace] = useState(false);
  const [draftHistory, setDraftHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);

  const maxHistory = 30;

  const pushHistory = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraftHistory((prev) => {
      if (prev[0] === trimmed) return prev;
      return [trimmed, ...prev].slice(0, maxHistory);
    });
    setHistoryIndex(-1);
    setHistoryDraft("");
  };

  const syncTextareaHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, 180);
    el.style.height = `${Math.max(40, next)}px`;
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.messages]);

  useEffect(() => {
    syncTextareaHeight();
  }, [input]);

  const tryAddAttachments = (next: ImageAttachment[]) => {
    const validation = validateImageAttachments(next, DEFAULT_IMAGE_ATTACHMENT_LIMITS);
    if (!validation.ok) {
      setAttachError(validation.error);
      return false;
    }
    setAttachments(next);
    setAttachError(null);
    return true;
  };

  const addFilesAsAttachments = async (files: FileList | File[], source: ImageAttachment["source"]) => {
    const incoming = Array.from(files);
    if (incoming.length === 0) return;
    const prepared: ImageAttachment[] = [];
    for (const file of incoming) {
      if (!file.type.startsWith("image/")) continue;
      const dataUrl = await fileToDataUrl(file);
      const parsed = parseDataUrlImage(dataUrl);
      if (!parsed.ok) { setAttachError(parsed.error); return; }
      prepared.push({
        name: normalizeImageAttachmentName(file.name, `image-${Date.now()}.png`),
        mimeType: parsed.mimeType,
        dataUrl,
        sizeBytes: parsed.sizeBytes,
        source,
      });
    }
    if (prepared.length === 0) { setAttachError("No supported images found."); return; }
    void tryAddAttachments([...attachments, ...prepared]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state.busy || submittingRef.current) return;
    if (!input.trim() && attachments.length === 0) return;
    const validation = validateImageAttachments(attachments, DEFAULT_IMAGE_ATTACHMENT_LIMITS);
    if (!validation.ok) { setAttachError(validation.error); return; }
    submittingRef.current = true;
    const textToSend = input;
    const attachmentsToSend = [...attachments];
    setInput("");
    setAttachments([]);
    setAttachError(null);
    const result = await sendMessage({ text: textToSend, attachments: attachmentsToSend });
    if (!result.ok) { submittingRef.current = false; return; }
    pushHistory(textToSend);
  };

  const applyHistory = (direction: "prev" | "next") => {
    if (draftHistory.length === 0) return;
    if (direction === "prev") {
      if (historyIndex === -1) {
        setHistoryDraft(input);
        setHistoryIndex(0);
        setInput(draftHistory[0] ?? input);
        return;
      }
      const nextIndex = Math.min(historyIndex + 1, draftHistory.length - 1);
      setHistoryIndex(nextIndex);
      setInput(draftHistory[nextIndex] ?? input);
      return;
    }
    if (historyIndex === -1) return;
    const nextIndex = historyIndex - 1;
    if (nextIndex < 0) { setHistoryIndex(-1); setInput(historyDraft); return; }
    setHistoryIndex(nextIndex);
    setInput(draftHistory[nextIndex] ?? "");
  };

  const handlePaste = async (e: React.ClipboardEvent<HTMLElement>) => {
    const imageFiles = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
    if (imageFiles.length === 0) return;
    e.preventDefault();
    await addFilesAsAttachments(imageFiles, "clipboard");
  };

  const handleDrop = async (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    if (state.busy) return;
    await addFilesAsAttachments(e.dataTransfer.files, "drop");
  };

  const handleDragOver = (e: React.DragEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!state.busy) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLFormElement>) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  };

  const removeAttachmentAt = (idx: number) => {
    const next = attachments.filter((_, i) => i !== idx);
    setAttachments(next);
    if (next.length === 0) setAttachError(null);
  };

  const totalAttachmentKb = Math.round(
    attachments.reduce((sum, item) => sum + item.sizeBytes, 0) / 1024
  );

  useEffect(() => { if (state.busy) setIsDragOver(false); }, [state.busy]);
  useEffect(() => { if (state.busy) submittingRef.current = false; }, [state.busy]);

  useEffect(() => {
    if (state.busy) return;
    if (attachments.length > DEFAULT_IMAGE_ATTACHMENT_LIMITS.maxCount) {
      setAttachments(attachments.slice(0, DEFAULT_IMAGE_ATTACHMENT_LIMITS.maxCount));
    }
  }, [attachments, state.busy]);

  const canSend = !state.busy && (input.trim().length > 0 || attachments.length > 0);

  const handleComposerKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = e.currentTarget;
    const atStart = target.selectionStart === 0 && target.selectionEnd === 0;
    const atEnd = target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
    const action = resolveInputShortcut(
      { key: e.key, shiftKey: e.shiftKey, ctrlKey: e.ctrlKey, metaKey: e.metaKey, altKey: e.altKey, isComposing: e.nativeEvent.isComposing },
      { canSend, busy: state.busy, cursorAtStart: atStart, cursorAtEnd: atEnd }
    );
    if (action === "none") return;
    e.preventDefault();
    if (action === "send") {
      if (!canSend || submittingRef.current) return;
      submittingRef.current = true;
      const textToSend = input;
      const attachmentsToSend = [...attachments];
      setInput("");
      setAttachments([]);
      setAttachError(null);
      const result = await sendMessage({ text: textToSend, attachments: attachmentsToSend });
      if (!result.ok) { submittingRef.current = false; return; }
      pushHistory(textToSend);
      return;
    }
    if (action === "insert_newline") {
      const start = target.selectionStart;
      const end = target.selectionEnd;
      const next = `${input.slice(0, start)}\n${input.slice(end)}`;
      setInput(next);
      queueMicrotask(() => inputRef.current?.setSelectionRange(start + 1, start + 1));
      return;
    }
    if (action === "history_prev") { applyHistory("prev"); return; }
    if (action === "history_next") { applyHistory("next"); return; }
    if (action === "clear_draft") { setInput(""); setHistoryIndex(-1); return; }
    if (action === "clear_session") { if (!state.busy) await sendClearSession(); return; }
  };

  const pct = state.contextSnapshot
    ? Math.round(state.contextSnapshot.usageFraction * 100)
    : 0;

  // Filter: hide trace/provider_retry unless showTrace
  const visibleMessages = state.messages.filter((entry) => {
    if (showTrace) return true;
    return entry.kind !== "trace" && entry.kind !== "provider_retry";
  });

  // Find what tool is currently running (for header activity indicator)
  const activeToolCall = state.messages
    .slice()
    .reverse()
    .find(
      (m): m is Extract<MessageEntry, { kind: "tool_call" }> =>
        m.kind === "tool_call" &&
        (m.status === "streaming" || m.status === "running" || m.status === "pending_approval")
    );

  return (
    <div style={styles.root}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div style={styles.header}>
        {/* Left: title + activity */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#33ccff", fontWeight: 800, fontSize: 15 }}>Liminal</span>
          {state.personaName !== "Liminal" && (
            <span style={{ color: "#cc66ff", fontSize: 12 }}>[{state.personaName}]</span>
          )}
          {!state.connected && (
            <span style={{ color: "#ff4444", fontSize: 11 }}>● disconnected</span>
          )}
          {activeToolCall && (
            <div style={styles.activityPill}>
              <span style={{ color: CATEGORY_META[getToolCategory(activeToolCall.name)].color }}>
                {CATEGORY_META[getToolCategory(activeToolCall.name)].icon}
              </span>
              <span style={{ color: "#99aabb", fontSize: 11 }}>{activeToolCall.name}</span>
              {activeToolCall.status === "pending_approval" && (
                <span style={{ color: "#ff66ff", fontSize: 11, fontWeight: 700 }}>— approve?</span>
              )}
            </div>
          )}
        </div>

        {/* Right: context bar + controls */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {state.contextSnapshot && (
            <div style={styles.ctxBarWrap}>
              <div
                style={{
                  ...styles.ctxBarFill,
                  width: `${pct}%`,
                  background: pct >= 80 ? "#ff4444" : pct >= 60 ? "#ffaa00" : "#44ff88",
                }}
              />
              <span style={{ color: pct >= 80 ? "#ff4444" : "#778", fontSize: 10 }}>
                {pct}% ctx{state.contextSnapshot.masked ? " [⊙]" : ""}
              </span>
            </div>
          )}
          <button
            type="button"
            style={{ ...styles.headerBtn, background: "#1a1a1a" }}
            disabled={state.busy}
            onClick={() => void sendClearSession()}
          >
            New session
          </button>
          <button
            type="button"
            style={{ ...styles.headerBtn, background: showTrace ? "#1a2c3a" : "#141414" }}
            onClick={() => setShowTrace((v) => !v)}
            title="Toggle harness trace lines"
          >
            {showTrace ? "Trace ●" : "Trace ○"}
          </button>
        </div>
      </div>

      {/* ── Messages ────────────────────────────────────────────── */}
      <div style={styles.messages}>
        {visibleMessages.length === 0 && !state.busy && (
          <div style={{ color: "#334", textAlign: "center", marginTop: 60, fontSize: 14 }}>
            Start a conversation…
          </div>
        )}
        {visibleMessages.map((entry, i) => (
          <MessageView key={i} entry={entry} />
        ))}
        {state.error && (
          <div style={{ color: "#ff4444", padding: "8px 0", fontSize: 13 }}>
            ✗ {state.error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Approval modal ──────────────────────────────────────── */}
      {state.pendingApproval && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            {/* Title row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ color: "#ff66ff", fontWeight: 700, fontSize: 14 }}>⚠ Approval needed</span>
                <span
                  style={{
                    color: CATEGORY_META[getToolCategory(state.pendingApproval.name)].color,
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  {CATEGORY_META[getToolCategory(state.pendingApproval.name)].icon}{" "}
                  {state.pendingApproval.name}
                </span>
              </div>
              <ApprovalCountdown
                receivedAt={state.pendingApproval.receivedAt}
                approvalTimeoutMs={state.pendingApproval.approvalTimeoutMs}
              />
            </div>

            {/* Args table */}
            <div style={styles.argsTable}>
              {Object.entries(state.pendingApproval.args)
                .filter(([, v]) => v !== undefined && v !== null)
                .map(([k, v]) => {
                  const raw =
                    typeof v === "string"
                      ? v.replace(/\n/g, "↩").slice(0, 300)
                      : JSON.stringify(v, null, 2).slice(0, 300);
                  return (
                    <div key={k} style={styles.argsRow}>
                      <span style={styles.argsKey}>{k}</span>
                      <span style={styles.argsVal}>{raw}</span>
                    </div>
                  );
                })}
            </div>

            {/* Buttons */}
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                style={{ ...styles.btn, background: "#0d3a1a", borderColor: "#1d7a3a", color: "#44ff88", flex: 1 }}
                onClick={() => sendApproval(state.pendingApproval!.callId, { decision: "approve" })}
              >
                ✓ Approve
              </button>
              <button
                style={{ ...styles.btn, background: "#3a0d0d", borderColor: "#7a1d1d", color: "#ff6666", flex: 1 }}
                onClick={() =>
                  sendApproval(state.pendingApproval!.callId, { decision: "reject", reason: "Rejected by user" })
                }
              >
                ✗ Reject
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Ask-user modal ───────────────────────────────────────── */}
      {state.pendingAskUser && (
        <div style={styles.modal}>
          <div style={styles.modalBox}>
            <div style={{ color: "#5599ff", fontWeight: 700, marginBottom: 10, fontSize: 14 }}>
              ◆ Agent question
            </div>
            <div style={{ marginBottom: 14, color: "#ccddee", lineHeight: 1.6, fontSize: 14, whiteSpace: "pre-wrap" }}>
              {state.pendingAskUser.prompt}
            </div>
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
              style={{ ...styles.btn, background: "#0d1e3a", borderColor: "#1d3a7a", color: "#5599ff", marginTop: 10, width: "100%" }}
              onClick={() => {
                if (askAnswer.trim()) { sendAnswer(askAnswer.trim()); setAskAnswer(""); }
              }}
            >
              Submit
            </button>
          </div>
        </div>
      )}

      {/* ── Input area ───────────────────────────────────────────── */}
      <form
        style={{
          ...styles.inputArea,
          borderTopColor: isDragOver ? "#33ccff" : "#1e1e1e",
          borderTopStyle: "solid" as const,
          borderTopWidth: 1,
          outline: isDragOver ? "1px dashed #33ccff" : "none",
        }}
        onSubmit={(e) => void handleSubmit(e)}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
      >
        {attachments.length > 0 && (
          <div style={styles.attachmentsRow}>
            {attachments.map((attachment, idx) => (
              <div key={`${attachment.name}-${idx}`} style={styles.attachmentChip}>
                <img src={attachment.dataUrl} alt={attachment.name} style={styles.attachmentPreview} />
                <span style={styles.attachmentLabel}>
                  {attachment.name} ({Math.round(attachment.sizeBytes / 1024)} KB)
                </span>
                <button
                  type="button"
                  style={styles.attachmentRemove}
                  onClick={() => removeAttachmentAt(idx)}
                  disabled={state.busy}
                >
                  ×
                </button>
              </div>
            ))}
            <span style={styles.attachmentMeta}>
              {attachments.length} image{attachments.length === 1 ? "" : "s"} ({totalAttachmentKb} KB)
            </span>
          </div>
        )}
        {attachError && <div style={styles.attachmentError}>{attachError}</div>}
        <div style={styles.composerRow}>
          <textarea
            id="chat-message-input"
            name="message"
            ref={inputRef}
            rows={1}
            style={styles.textarea}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (historyIndex !== -1) setHistoryIndex(-1);
            }}
            onKeyDown={(e) => void handleComposerKeyDown(e)}
            onPaste={(e) => void handlePaste(e)}
            placeholder={state.busy ? "Thinking…" : "Message Liminal…"}
            disabled={state.busy || !state.connected}
          />
          <button
            type="submit"
            style={{
              ...styles.btn,
              background: canSend ? "#005580" : "#1a1a1a",
              borderColor: canSend ? "#0077aa" : "#2a2a2a",
              color: canSend ? "#e0e0e0" : "#555",
              cursor: canSend ? "pointer" : "default",
            }}
            disabled={!canSend}
          >
            Send
          </button>
        </div>
        <div style={styles.shortcutHint}>
          Enter send · Shift+Enter newline · Ctrl/Cmd+K clear · Ctrl/Cmd+L new session
        </div>
      </form>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100vh",
    background: "#0a0a0c",
    color: "#dde",
    fontFamily: "system-ui, -apple-system, sans-serif",
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 16px",
    borderBottom: "1px solid #1a1a1a",
    background: "#0d0d10",
    flexShrink: 0,
    gap: 12,
  },
  activityPill: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#111318",
    border: "1px solid #223",
    borderRadius: 20,
    padding: "2px 10px",
    fontSize: 11,
  },
  ctxBarWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: 140,
  },
  ctxBarFill: {
    height: 3,
    borderRadius: 2,
    transition: "width 0.4s ease",
    flex: 1,
  },
  headerBtn: {
    border: "1px solid #2a2a2a",
    borderRadius: 5,
    color: "#99aabb",
    padding: "5px 10px",
    fontSize: 11,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  messages: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "16px 20px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  userMsg: {
    padding: "8px 12px",
    background: "#0f1520",
    borderRadius: 6,
    borderLeft: "2px solid #33ccff",
    lineHeight: 1.5,
  },
  assistantMsg: {
    padding: "6px 0",
    color: "#44dd88",
    lineHeight: 1.6,
  },
  mdParagraph: { margin: "0 0 10px", whiteSpace: "normal" as const, lineHeight: 1.6 },
  mdList: { margin: "0 0 10px 20px" },
  mdOrderedList: { margin: "0 0 10px 20px" },
  mdListItem: { margin: "2px 0" },
  mdH1: { fontSize: 22, margin: "8px 0", color: "#7cf5a9" },
  mdH2: { fontSize: 19, margin: "8px 0", color: "#7cf5a9" },
  mdH3: { fontSize: 16, margin: "8px 0", color: "#7cf5a9" },
  mdInlineCode: {
    background: "#131a13",
    border: "1px solid #2a3a2a",
    borderRadius: 4,
    padding: "1px 5px",
    color: "#9bf2b8",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  mdPre: {
    margin: "10px 0",
    padding: "10px 14px",
    borderRadius: 6,
    background: "#0d1410",
    border: "1px solid #1e2e1e",
    overflowX: "auto" as const,
  },
  mdCodeBlock: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    color: "#9bf2b8",
    fontSize: 13,
  },
  mdQuote: {
    margin: "10px 0",
    padding: "4px 12px",
    borderLeft: "3px solid #2d6a4f",
    color: "#9acfb0",
  },
  mdTableWrap: { overflowX: "auto" as const, margin: "10px 0" },
  mdTable: { width: "100%", borderCollapse: "collapse" as const, border: "1px solid #2a2a2a" },
  mdTableHead: {
    textAlign: "left" as const,
    border: "1px solid #2a2a2a",
    padding: "6px 8px",
    background: "#111",
  },
  mdTableCell: {
    border: "1px solid #2a2a2a",
    padding: "6px 8px",
    verticalAlign: "top" as const,
  },
  mdHr: { border: "none", borderTop: "1px solid #222", margin: "10px 0" },
  toolCard: {
    borderRadius: 5,
    padding: "7px 12px",
    background: "#0e1016",
    border: "1px solid #1e2030",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 12,
  },
  toolResultWrap: {
    paddingLeft: 20,
    paddingTop: 2,
    paddingBottom: 4,
  },
  toolOutputPre: {
    margin: 0,
    padding: "6px 10px",
    background: "#0a0d0a",
    border: "1px solid #1a2a1a",
    borderRadius: 4,
    fontSize: 11,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    lineHeight: 1.5,
    maxHeight: 260,
    overflowY: "auto" as const,
  },
  thinkBubble: {
    padding: "8px 12px",
    background: "#0c0e14",
    border: "1px solid #1a1e2a",
    borderLeft: "2px solid #334",
    borderRadius: 5,
    lineHeight: 1.5,
  },
  planCard: {
    padding: "10px 14px",
    background: "#090e18",
    border: "1px solid #162040",
    borderLeft: "2px solid #2a4a88",
    borderRadius: 5,
  },
  subtaskCard: {
    padding: "6px 12px",
    background: "#0c0c10",
    borderRadius: 4,
    fontSize: 13,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    borderLeft: "2px solid #33ddff",
    color: "#bbc",
  },
  contextCompressed: {
    padding: "4px 12px",
    color: "#556",
    fontSize: 11,
    fontStyle: "italic" as const,
    borderLeft: "2px solid #334",
    lineHeight: 1.5,
  },
  traceLine: {
    paddingLeft: 10,
    borderLeft: "2px solid #1a1a22",
    lineHeight: 1.4,
    opacity: 0.7,
  },
  inputArea: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: "12px 16px",
    background: "#0d0d10",
    flexShrink: 0,
  },
  composerRow: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    background: "#111116",
    border: "1px solid #252530",
    borderRadius: 6,
    color: "#dde",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    resize: "none" as const,
    minHeight: 40,
    maxHeight: 180,
    overflowY: "auto" as const,
    lineHeight: 1.4,
  },
  shortcutHint: {
    fontSize: 10,
    color: "#445",
    letterSpacing: "0.02em",
  },
  btn: {
    border: "1px solid #333",
    borderRadius: 5,
    color: "#dde",
    padding: "8px 16px",
    fontSize: 13,
    cursor: "pointer",
    fontFamily: "inherit",
  },
  modal: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.75)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modalBox: {
    background: "#111116",
    border: "1px solid #2a2a3a",
    borderRadius: 8,
    padding: 22,
    width: 500,
    maxWidth: "90vw",
    maxHeight: "80vh",
    overflowY: "auto" as const,
  },
  argsTable: {
    background: "#0a0a0e",
    border: "1px solid #1e1e2a",
    borderRadius: 5,
    overflow: "hidden" as const,
  },
  argsRow: {
    display: "flex",
    borderBottom: "1px solid #141420",
    fontSize: 12,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
  },
  argsKey: {
    color: "#5577aa",
    padding: "5px 10px",
    background: "#0d0d14",
    flexShrink: 0,
    minWidth: 100,
    borderRight: "1px solid #1a1a28",
    fontWeight: 700,
  },
  argsVal: {
    color: "#99aabb",
    padding: "5px 10px",
    whiteSpace: "pre-wrap" as const,
    wordBreak: "break-all" as const,
    flex: 1,
  },
  answerInput: {
    width: "100%",
    background: "#0d0d12",
    border: "1px solid #2a2a3a",
    borderRadius: 4,
    color: "#dde",
    padding: "8px 12px",
    fontSize: 14,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  attachmentsRow: {
    display: "flex",
    flexWrap: "wrap" as const,
    gap: 8,
    alignItems: "center",
  },
  attachmentChip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    background: "#111820",
    border: "1px solid #1e2e40",
    borderRadius: 5,
    padding: "3px 6px",
  },
  attachmentPreview: {
    width: 22,
    height: 22,
    objectFit: "cover" as const,
    borderRadius: 3,
  },
  attachmentLabel: { fontSize: 11, color: "#99bbdd" },
  attachmentRemove: {
    border: "none",
    background: "transparent",
    color: "#ff7777",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    padding: 0,
  },
  attachmentMeta: { fontSize: 11, color: "#556677" },
  attachmentError: { color: "#ff6666", fontSize: 12 },
};
