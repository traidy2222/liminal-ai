import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { AgentHarness, ChatMetadata } from "@liminal/core";
import type { MessageEntry } from "./useAgent.js";
import { DEFAULT_IMAGE_ATTACHMENT_LIMITS, validateImageAttachments, type ImageAttachment } from "@liminal/core";
import { PERSONA_QUICK_PRESETS } from "@liminal/core/persona-bootstrap-ui";
import { useAgent } from "./useAgent.js";
import { resolveInputShortcut } from "./inputSemantics.js";
import { StatusBar } from "./components/StatusBar.js";
import { MessageItem } from "./components/MessageItem.js";
import { InputLine } from "./components/InputLine.js";
import { ApprovalModal } from "./components/ApprovalModal.js";
import { AskUserModal } from "./components/AskUserModal.js";
import { PersonaBootstrapModal } from "./components/PersonaBootstrapModal.js";
import { extractImagePathsFromText, imagePathToAttachment, parseAttachCommand } from "./imageAttachments.js";
import { presentAutoDream } from "./autoDreamPresent.js";
import { usePersonaChrome } from "./personaChromeContext.js";
import {
  parseIntegrationSlashCommand,
  runIntegrationSlashCommand,
} from "./integrationSlashCommands.js";

/** Message window size; keep moderate to reduce redraw churn. */
const WINDOW_SIZE = 90;

interface Props {
  harness: AgentHarness;
  chatMeta?: ChatMetadata;
  initialMessages?: MessageEntry[];
}

function parseMouseWheelDelta(input: string): number | null {
  // SGR mouse mode wheel events:
  //   ESC [ < 64 ; x ; y M  => wheel up
  //   ESC [ < 65 ; x ; y M  => wheel down
  // Some terminals may send lowercase trailing marker too.
  const match = /^\u001b\[<(\d+);/.exec(input);
  if (!match) return null;
  const code = Number(match[1]);
  if (code === 64) return 1;
  if (code === 65) return -1;
  return null;
}

function isPrintableInputChar(input: string): boolean {
  // Reject control bytes / escape sequences so mouse or terminal control
  // traffic never mutates user-entered text.
  if (!input || /[\x00-\x1f\x7f]/.test(input)) {
    return false;
  }
  return true;
}

export function App({ harness, chatMeta, initialMessages }: Props) {
  const jarvis = usePersonaChrome().colors;
  const {
    state,
    sendMessage,
    submitPersonaBootstrap,
    resolveApproval,
    resolveAskUser,
    clearSession,
  } = useAgent(harness, { initialMessages });

  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;

  const memorySyncStatus = useMemo(() => {
    const quiet = process.env["AGENT_UI_VERBOSITY"]?.trim() === "quiet";
    const dreamIdle = state.autoDream.stage === "idle";
    const pill = dreamIdle
      ? ""
      : presentAutoDream(state.autoDream, { verbosity: quiet ? "quiet" : "normal" }).pillHeadline;
    const pulse = state.personalityPulseLine?.trim() ?? "";
    if (dreamIdle && !pulse) return null;
    const combined = [pill, pulse].filter(Boolean).join(" · ");
    const reserve = 54;
    const max = Math.max(12, cols - reserve);
    return combined.length > max ? `${combined.slice(0, max - 1)}…` : combined;
  }, [state.autoDream, state.personalityPulseLine, cols]);
  const rows = stdout?.rows ?? 30;

  /** Multiline text buffer user is typing in the chat input. */
  const [chatLines, setChatLines] = useState<string[]>([""]);
  const [cursorRow, setCursorRow] = useState(0);
  const [cursorCol, setCursorCol] = useState(0);
  const [pendingAttachments, setPendingAttachments] = useState<ImageAttachment[]>([]);
  const [inputStatus, setInputStatus] = useState<string | null>(null);
  const [draftHistory, setDraftHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [historyDraft, setHistoryDraft] = useState("");
  /** Text the user is typing for an ask_user answer. */
  const [askInput, setAskInput] = useState("");
  /**
   * How many messages from the end are excluded.
   * 0 = show latest; N = scroll N messages back from the most recent.
   */
  const [scrollOffset, setScrollOffset] = useState(0);
  const [bootstrapDraft, setBootstrapDraft] = useState("");
  const [integrationBusy, setIntegrationBusy] = useState(false);

  useEffect(() => {
    if (!state.personaBootstrapPending) setBootstrapDraft("");
  }, [state.personaBootstrapPending]);

  /* ── Auto-scroll to bottom when a turn completes ──────────────── */
  const prevBusy = useRef(state.busy);
  useEffect(() => {
    if (prevBusy.current && !state.busy) {
      setScrollOffset(0);
    }
    prevBusy.current = state.busy;
  }, [state.busy]);

  /* ── Layout ───────────────────────────────────────────────────── */
  const hasBootstrap = state.personaBootstrapPending;
  const hasApproval = !!state.pendingApproval;
  const hasAskUser = !!state.pendingAskUser;

  // Estimate lines consumed by the bottom area
  const inputAreaH = hasApproval
    ? 5
    : hasAskUser
      ? 4
      : hasBootstrap
        ? 16
        : Math.min(4, chatLines.length) + (pendingAttachments.length > 0 ? 1 : 0) + (inputStatus ? 1 : 0);
  // Fixed layout rows to avoid terminal jitter/flicker:
  // status(1) + top divider(1) + top indicator(1) + bottom indicator(1) + error row(1) + bottom divider(1) + input
  const transcriptH = Math.max(4, rows - (1 + 1 + 1 + 1 + 1 + 1 + inputAreaH));

  /* ── Message windowing ────────────────────────────────────────── */
  const messages = state.messages;
  const total = messages.length;
  const safeOffset = Math.min(scrollOffset, Math.max(0, total - 1));
  const endIdx = Math.max(0, total - safeOffset);
  const startIdx = Math.max(0, endIdx - WINDOW_SIZE);
  const visibleMessages = useMemo(
    () => messages.slice(startIdx, endIdx),
    [messages, startIdx, endIdx]
  );
  const olderCount = startIdx; // messages older than the window
  const newerCount = safeOffset; // messages newer that were scrolled past

  /* ── Unified keyboard handler ─────────────────────────────────── */
  const currentDraft = useMemo(() => chatLines.join("\n"), [chatLines]);
  const maxHistory = 30;

  const setDraftText = useCallback((text: string) => {
    const lines = text.length > 0 ? text.split("\n") : [""];
    setChatLines(lines);
    setCursorRow(lines.length - 1);
    setCursorCol(lines[lines.length - 1]?.length ?? 0);
  }, []);

  const pushHistory = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setDraftHistory((prev) => {
      if (prev[0] === trimmed) return prev;
      return [trimmed, ...prev].slice(0, maxHistory);
    });
    setHistoryIndex(-1);
    setHistoryDraft("");
  }, []);

  const handleSend = useCallback(async () => {
    if (state.busy || integrationBusy) return;
    if (state.personaBootstrapPending) {
      setInputStatus("Finish personality setup in the panel below first.");
      return;
    }
    const integrationCmd = parseIntegrationSlashCommand(currentDraft);
    if (integrationCmd) {
      setIntegrationBusy(true);
      setInputStatus("Opening browser for integration sign-in…");
      try {
        const result = await runIntegrationSlashCommand(integrationCmd);
        setDraftText("");
        setInputStatus(result.message);
      } catch (err) {
        setInputStatus(err instanceof Error ? err.message : String(err));
      } finally {
        setIntegrationBusy(false);
      }
      return;
    }
    const attachPath = parseAttachCommand(currentDraft);
    if (attachPath !== null) {
      if (!attachPath) {
        setInputStatus("Usage: /attach <image-path>");
        return;
      }
      const attached = await imagePathToAttachment(attachPath);
      if (!attached.ok) {
        setInputStatus(attached.error);
        return;
      }
      const next = [...pendingAttachments, attached.attachment];
      const validation = validateImageAttachments(next, DEFAULT_IMAGE_ATTACHMENT_LIMITS);
      if (!validation.ok) {
        setInputStatus(validation.error);
        return;
      }
      setPendingAttachments(next);
      setDraftText("");
      setInputStatus(`Attached ${attached.attachment.name}`);
      return;
    }

    const { paths, remainingText } = extractImagePathsFromText(currentDraft);
    const inlineAttachments: ImageAttachment[] = [];
    for (const p of paths) {
      const parsed = await imagePathToAttachment(p);
      if (!parsed.ok) {
        setInputStatus(parsed.error);
        return;
      }
      inlineAttachments.push(parsed.attachment);
    }
    const mergedAttachments = [...pendingAttachments, ...inlineAttachments];
    const validation = validateImageAttachments(
      mergedAttachments,
      DEFAULT_IMAGE_ATTACHMENT_LIMITS
    );
    if (!validation.ok) {
      setInputStatus(validation.error);
      return;
    }
    if (!remainingText && mergedAttachments.length === 0) return;

    sendMessage(remainingText, mergedAttachments);
    pushHistory(currentDraft);
    setDraftText("");
    setPendingAttachments([]);
    setInputStatus(null);
    setScrollOffset(0);
  }, [
    currentDraft,
    integrationBusy,
    pendingAttachments,
    pushHistory,
    sendMessage,
    setDraftText,
    state.busy,
    state.personaBootstrapPending,
  ]);

  const insertTextAtCursor = useCallback((text: string) => {
    const lines = [...chatLines];
    const row = Math.max(0, Math.min(cursorRow, lines.length - 1));
    const col = Math.max(0, Math.min(cursorCol, lines[row]?.length ?? 0));
    const line = lines[row] ?? "";
    lines[row] = `${line.slice(0, col)}${text}${line.slice(col)}`;
    setChatLines(lines);
    setCursorRow(row);
    setCursorCol(col + text.length);
  }, [chatLines, cursorCol, cursorRow]);

  const insertNewlineAtCursor = useCallback(() => {
    const lines = [...chatLines];
    const row = Math.max(0, Math.min(cursorRow, lines.length - 1));
    const col = Math.max(0, Math.min(cursorCol, lines[row]?.length ?? 0));
    const line = lines[row] ?? "";
    const before = line.slice(0, col);
    const after = line.slice(col);
    lines[row] = before;
    lines.splice(row + 1, 0, after);
    setChatLines(lines);
    setCursorRow(row + 1);
    setCursorCol(0);
  }, [chatLines, cursorCol, cursorRow]);

  const backspaceAtCursor = useCallback(() => {
    const lines = [...chatLines];
    const row = Math.max(0, Math.min(cursorRow, lines.length - 1));
    const col = Math.max(0, Math.min(cursorCol, lines[row]?.length ?? 0));
    if (col > 0) {
      const line = lines[row] ?? "";
      lines[row] = `${line.slice(0, col - 1)}${line.slice(col)}`;
      setChatLines(lines);
      setCursorRow(row);
      setCursorCol(col - 1);
      return;
    }
    if (row === 0) return;
    const prev = lines[row - 1] ?? "";
    const curr = lines[row] ?? "";
    lines[row - 1] = prev + curr;
    lines.splice(row, 1);
    setChatLines(lines);
    setCursorRow(row - 1);
    setCursorCol(prev.length);
  }, [chatLines, cursorCol, cursorRow]);

  const deleteAtCursor = useCallback(() => {
    const lines = [...chatLines];
    const row = Math.max(0, Math.min(cursorRow, lines.length - 1));
    const col = Math.max(0, Math.min(cursorCol, lines[row]?.length ?? 0));
    const line = lines[row] ?? "";
    if (col < line.length) {
      lines[row] = `${line.slice(0, col)}${line.slice(col + 1)}`;
      setChatLines(lines);
      return;
    }
    if (row >= lines.length - 1) return;
    lines[row] = line + (lines[row + 1] ?? "");
    lines.splice(row + 1, 1);
    setChatLines(lines);
  }, [chatLines, cursorCol, cursorRow]);

  const applyHistory = useCallback((direction: "prev" | "next") => {
    if (draftHistory.length === 0) return;
    if (direction === "prev") {
      if (historyIndex === -1) {
        setHistoryDraft(currentDraft);
        setHistoryIndex(0);
        setDraftText(draftHistory[0] ?? currentDraft);
        return;
      }
      const next = Math.min(historyIndex + 1, draftHistory.length - 1);
      setHistoryIndex(next);
      setDraftText(draftHistory[next] ?? currentDraft);
      return;
    }
    if (historyIndex === -1) return;
    const next = historyIndex - 1;
    if (next < 0) {
      setHistoryIndex(-1);
      setDraftText(historyDraft);
      return;
    }
    setHistoryIndex(next);
    setDraftText(draftHistory[next] ?? "");
  }, [currentDraft, draftHistory, historyDraft, historyIndex, setDraftText]);

  useInput((char, key) => {
    const wheelDelta = parseMouseWheelDelta(char);
    if (wheelDelta !== null) {
      if (wheelDelta > 0) {
        setScrollOffset((n) => Math.min(n + 1, Math.max(0, total - 1)));
      } else {
        setScrollOffset((n) => Math.max(0, n - 1));
      }
      return;
    }

    if (
      state.personaBootstrapPending &&
      !state.pendingApproval &&
      !state.pendingAskUser
    ) {
      if (state.personaBootstrapSubmitting) return;
      if (key.return) {
        void submitPersonaBootstrap(bootstrapDraft).catch(() => undefined);
        return;
      }
      if (state.personaBootstrapAllowSkip && (char === "d" || char === "D")) {
        void submitPersonaBootstrap("", { skip: true }).catch(() => undefined);
        return;
      }
      const presetIdx = char >= "1" && char <= "4" ? Number(char) - 1 : -1;
      if (presetIdx >= 0 && presetIdx < PERSONA_QUICK_PRESETS.length) {
        setBootstrapDraft(PERSONA_QUICK_PRESETS[presetIdx]!);
        return;
      }
      if (key.backspace || key.delete) {
        setBootstrapDraft((s) => s.slice(0, -1));
        return;
      }
      if (isPrintableInputChar(char) && !key.ctrl && !key.meta) {
        setBootstrapDraft((s) => s + char);
      }
      return;
    }

    /* ── Approval mode ──────────────────────────────────────────── */
    if (state.pendingApproval) {
      if (char === "a" || char === "A" || key.return) {
        resolveApproval({ decision: "approve" });
        return;
      }
      if (char === "r" || char === "R" || char === "d" || char === "D") {
        resolveApproval({ decision: "reject", reason: "Rejected by user" });
        return;
      }
      return; // swallow other keys while approval is pending
    }

    /* ── Ask-user answer mode ───────────────────────────────────── */
    if (state.pendingAskUser) {
      if (key.return) {
        resolveAskUser(askInput);
        setAskInput("");
        return;
      }
      if (key.backspace || key.delete) {
        setAskInput((s) => s.slice(0, -1));
        return;
      }
      if (isPrintableInputChar(char) && !key.ctrl && !key.meta) {
        setAskInput((s) => s + char);
      }
      return;
    }

    /* ── Scroll ─────────────────────────────────────────────────── */
    if (key.upArrow) {
      setScrollOffset((n) => Math.min(n + 1, Math.max(0, total - 1)));
      return;
    }
    if (key.downArrow) {
      setScrollOffset((n) => Math.max(0, n - 1));
      return;
    }
    if (key.pageUp) {
      setScrollOffset((n) => Math.min(n + 10, Math.max(0, total - 1)));
      return;
    }
    if (key.pageDown) {
      setScrollOffset((n) => Math.max(0, n - 10));
      return;
    }
    if (key.escape) {
      setScrollOffset(0);
      return;
    }

    /* ── Shortcuts ──────────────────────────────────────────────── */
    if (key.ctrl && char === "k") {
      setDraftText("");
      setHistoryIndex(-1);
      return;
    }
    if (key.ctrl && char === "l") {
      if (!state.busy) {
        clearSession();
        setScrollOffset(0);
      }
      return;
    }
    if (key.ctrl && char === "c") {
      process.exit(0);
    }

    /* ── Chat input ─────────────────────────────────────────────── */
    const atStart = cursorRow === 0 && cursorCol === 0;
    const lastRow = Math.max(0, chatLines.length - 1);
    const atEnd = cursorRow === lastRow && cursorCol === (chatLines[lastRow]?.length ?? 0);
    const canSend = !state.busy && (currentDraft.trim().length > 0 || pendingAttachments.length > 0);
    const action = resolveInputShortcut(
      {
        key: key.return ? "Enter" : key.upArrow ? "ArrowUp" : key.downArrow ? "ArrowDown" : char,
        shiftKey: key.shift,
        ctrlKey: key.ctrl,
        metaKey: key.meta,
        altKey: false,
      },
      {
        canSend,
        busy: state.busy,
        cursorAtStart: atStart,
        cursorAtEnd: atEnd,
      }
    );
    if (action === "send") {
      void handleSend();
      return;
    }
    if (action === "insert_newline") {
      insertNewlineAtCursor();
      return;
    }
    if (action === "history_prev") {
      applyHistory("prev");
      return;
    }
    if (action === "history_next") {
      applyHistory("next");
      return;
    }
    if (key.return) {
      void handleSend();
      return;
    }
    if (key.backspace) {
      backspaceAtCursor();
      return;
    }
    if (key.delete) {
      deleteAtCursor();
      return;
    }
    if (key.leftArrow) {
      if (cursorCol > 0) setCursorCol((c) => c - 1);
      else if (cursorRow > 0) {
        const prevLen = chatLines[cursorRow - 1]?.length ?? 0;
        setCursorRow((r) => r - 1);
        setCursorCol(prevLen);
      }
      return;
    }
    if (key.rightArrow) {
      const lineLen = chatLines[cursorRow]?.length ?? 0;
      if (cursorCol < lineLen) setCursorCol((c) => c + 1);
      else if (cursorRow < chatLines.length - 1) {
        setCursorRow((r) => r + 1);
        setCursorCol(0);
      }
      return;
    }
    // Multi-character input with embedded newlines = bracketed or rapid paste
    if (!key.ctrl && !key.meta && char.length > 1 && /[\r\n]/.test(char)) {
      const segments = char.split(/\r\n|\r|\n/);
      for (let i = 0; i < segments.length; i++) {
        const seg = segments[i] ?? "";
        if (seg) {
          // Filter out any remaining control chars within the segment
          const clean = seg.replace(/[\x00-\x1f\x7f]/g, "");
          if (clean) insertTextAtCursor(clean);
        }
        if (i < segments.length - 1) insertNewlineAtCursor();
      }
      if (historyIndex !== -1) setHistoryIndex(-1);
      if (inputStatus) setInputStatus(null);
      return;
    }
    if (isPrintableInputChar(char) && !key.ctrl && !key.meta) {
      insertTextAtCursor(char);
      if (historyIndex !== -1) setHistoryIndex(-1);
      if (inputStatus) setInputStatus(null);
    }
  });

  /* ── Divider ─────────────────────────────────────────────────── */
  const divider = "─".repeat(cols);

  return (
    <Box flexDirection="column" width={cols} height={rows}>
      {/* ── Status bar ──────────────────────────────────────────── */}
      <StatusBar
        modelSlug={harness.config.model ?? ""}
        personaName={state.personaName}
        snapshot={state.contextSnapshot}
        busy={state.busy || state.personalityPulseActive}
        width={cols}
        memorySync={memorySyncStatus}
      />
      <Text color={jarvis.muted} dimColor>{divider}</Text>

      {/* ── Scroll-up indicator (always reserve one row to prevent jump) ───────── */}
      <Box paddingX={1} height={1}>
        {olderCount > 0 ? (
          <Text dimColor color={jarvis.warn}>
            {"↑ "}{olderCount} older message{olderCount !== 1 ? "s" : ""}{" — press ↑ / PgUp"}
          </Text>
        ) : (
          <Text dimColor color={jarvis.muted}>{" "}</Text>
        )}
      </Box>

      {/* ── Transcript: flex-end pushes content to bottom; overflow clips top ── */}
      <Box
        flexDirection="column"
        flexGrow={1}
        height={transcriptH}
        overflowY="hidden"
        justifyContent="flex-end"
        paddingX={1}
      >
        {visibleMessages.length === 0 && (
          <Text dimColor color={jarvis.muted}>
            {"  Type a message and press Enter to begin."}
          </Text>
        )}
        {visibleMessages.map((entry, i) => (
          <MessageItem key={startIdx + i} entry={entry} width={cols - 2} />
        ))}
      </Box>

      {/* ── Scroll-down indicator (always reserve one row to prevent jump) ─────── */}
      <Box paddingX={1} height={1}>
        {newerCount > 0 ? (
          <Text dimColor color={jarvis.warn}>
            {"↓ "}{newerCount} newer message{newerCount !== 1 ? "s" : ""}{" — press ↓ / Esc"}
          </Text>
        ) : (
          <Text dimColor color={jarvis.muted}>{" "}</Text>
        )}
      </Box>

      {/* ── Error banner (always reserve one row to prevent jump) ──────────────── */}
      <Box paddingX={1} height={1}>
        {state.error ? (
          <Text color={jarvis.danger} wrap="truncate-end">
            {"✗ "}{state.error.length > cols - 4 ? state.error.slice(0, cols - 5) + "…" : state.error}
          </Text>
        ) : (
          <Text dimColor color={jarvis.muted}>{" "}</Text>
        )}
      </Box>

      <Text color={jarvis.muted} dimColor>{divider}</Text>

      {/* ── Bottom area: input / approval / ask-user ─────────────── */}
      {hasApproval && state.pendingApproval && (
        <ApprovalModal payload={state.pendingApproval} width={cols} />
      )}
      {!hasApproval && hasAskUser && state.pendingAskUser && (
        <AskUserModal payload={state.pendingAskUser} input={askInput} width={cols} />
      )}
      {!hasApproval && !hasAskUser && hasBootstrap && (
        <PersonaBootstrapModal
          width={cols}
          draft={bootstrapDraft}
          submitting={state.personaBootstrapSubmitting}
          progress={state.personaBootstrapProgress}
          stage={state.personaBootstrapStage}
          allowSkip={state.personaBootstrapAllowSkip}
          artifacts={state.personaBootstrapArtifacts}
        />
      )}
      {!hasApproval && !hasAskUser && !hasBootstrap && (
        <InputLine
          lines={chatLines}
          cursorRow={cursorRow}
          cursorCol={cursorCol}
          busy={state.busy || integrationBusy}
          scrollOffset={scrollOffset}
          attachments={pendingAttachments}
          status={inputStatus}
          width={cols}
        />
      )}
    </Box>
  );
}
