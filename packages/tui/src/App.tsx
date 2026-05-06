import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { AgentHarness } from "@liminal/core";
import { DEFAULT_IMAGE_ATTACHMENT_LIMITS, validateImageAttachments, type ImageAttachment } from "@liminal/core";
import { useAgent } from "./useAgent.js";
import { StatusBar } from "./components/StatusBar.js";
import { MessageItem } from "./components/MessageItem.js";
import { InputLine } from "./components/InputLine.js";
import { ApprovalModal } from "./components/ApprovalModal.js";
import { AskUserModal } from "./components/AskUserModal.js";
import { extractImagePathsFromText, imagePathToAttachment, parseAttachCommand } from "./imageAttachments.js";

/** Message window size; keep moderate to reduce redraw churn. */
const WINDOW_SIZE = 90;

interface Props {
  harness: AgentHarness;
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

export function App({ harness }: Props) {
  const {
    state,
    sendMessage,
    resolveApproval,
    resolveAskUser,
    clearSession,
  } = useAgent(harness);

  const { stdout } = useStdout();
  const cols = stdout?.columns ?? 100;
  const rows = stdout?.rows ?? 30;

  /** Text the user is typing in the chat input. */
  const [chatInput, setChatInput] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<ImageAttachment[]>([]);
  const [inputStatus, setInputStatus] = useState<string | null>(null);
  /** Text the user is typing for an ask_user answer. */
  const [askInput, setAskInput] = useState("");
  /**
   * How many messages from the end are excluded.
   * 0 = show latest; N = scroll N messages back from the most recent.
   */
  const [scrollOffset, setScrollOffset] = useState(0);

  /* ── Auto-scroll to bottom when a turn completes ──────────────── */
  const prevBusy = useRef(state.busy);
  useEffect(() => {
    if (prevBusy.current && !state.busy) {
      setScrollOffset(0);
    }
    prevBusy.current = state.busy;
  }, [state.busy]);

  /* ── Layout ───────────────────────────────────────────────────── */
  const hasApproval = !!state.pendingApproval;
  const hasAskUser = !!state.pendingAskUser;

  // Estimate lines consumed by the bottom area
  const inputAreaH =
    hasApproval
      ? 5
      : hasAskUser
      ? 4
      : 1 + (pendingAttachments.length > 0 ? 1 : 0) + (inputStatus ? 1 : 0);
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
  const handleSend = useCallback(async () => {
    if (state.busy) return;
    const attachPath = parseAttachCommand(chatInput);
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
      setChatInput("");
      setInputStatus(`Attached ${attached.attachment.name}`);
      return;
    }

    const { paths, remainingText } = extractImagePathsFromText(chatInput);
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
    setChatInput("");
    setPendingAttachments([]);
    setInputStatus(null);
    setScrollOffset(0);
  }, [chatInput, pendingAttachments, sendMessage, state.busy]);

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
      if (!state.busy) {
        clearSession();
        setScrollOffset(0);
        setChatInput("");
      }
      return;
    }
    if (key.ctrl && char === "c") {
      process.exit(0);
    }

    /* ── Chat input ─────────────────────────────────────────────── */
    if (key.return) {
      void handleSend();
      return;
    }
    if (key.backspace || key.delete) {
      setChatInput((s) => s.slice(0, -1));
      return;
    }
    if (isPrintableInputChar(char) && !key.ctrl && !key.meta) {
      setChatInput((s) => s + char);
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
        busy={state.busy}
        width={cols}
      />
      <Text color="gray" dimColor>{divider}</Text>

      {/* ── Scroll-up indicator (always reserve one row to prevent jump) ───────── */}
      <Box paddingX={1} height={1}>
        {olderCount > 0 ? (
          <Text dimColor color="yellow">
            {"↑ "}{olderCount} older message{olderCount !== 1 ? "s" : ""}{" — press ↑ / PgUp"}
          </Text>
        ) : (
          <Text dimColor color="gray">{" "}</Text>
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
          <Text dimColor color="gray">
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
          <Text dimColor color="yellow">
            {"↓ "}{newerCount} newer message{newerCount !== 1 ? "s" : ""}{" — press ↓ / Esc"}
          </Text>
        ) : (
          <Text dimColor color="gray">{" "}</Text>
        )}
      </Box>

      {/* ── Error banner (always reserve one row to prevent jump) ──────────────── */}
      <Box paddingX={1} height={1}>
        {state.error ? (
          <Text color="red" wrap="truncate-end">
            {"✗ "}{state.error.length > cols - 4 ? state.error.slice(0, cols - 5) + "…" : state.error}
          </Text>
        ) : (
          <Text dimColor color="gray">{" "}</Text>
        )}
      </Box>

      <Text color="gray" dimColor>{divider}</Text>

      {/* ── Bottom area: input / approval / ask-user ─────────────── */}
      {hasApproval && state.pendingApproval && (
        <ApprovalModal payload={state.pendingApproval} width={cols} />
      )}
      {!hasApproval && hasAskUser && state.pendingAskUser && (
        <AskUserModal payload={state.pendingAskUser} input={askInput} width={cols} />
      )}
      {!hasApproval && !hasAskUser && (
        <InputLine
          value={chatInput}
          busy={state.busy}
          scrollOffset={scrollOffset}
          attachments={pendingAttachments}
          status={inputStatus}
          width={cols}
        />
      )}
    </Box>
  );
}
