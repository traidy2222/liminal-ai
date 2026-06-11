import React, { useCallback, useLayoutEffect, useRef, type CSSProperties } from "react";
import { migratePersonaUiTheme, type PersonaUiThemeV2 } from "@liminal/core/persona-ui-theme";
import { DictationButton } from "../../audio/DictationButton.js";
import { useComposerDictation } from "../../useComposerDictation.js";
import type { ShellContract } from "../ShellContract.js";
import { buildInputAreaStyle, buildInputDockStyle } from "../shellLayout.js";
import { LIM } from "../personaVars.js";
import { TerminalDock } from "../../terminal/TerminalDock.js";
import { BrowserDock } from "../../browser/BrowserDock.js";

export type ShellComposerVariant = "hud" | "terminal" | "studio" | "minimal";

const CYAN = "var(--lim-accent, #00d4ff)";
const RED_ERR = "var(--lim-danger, #ff2244)";

/**
 * Sync textarea height to content via direct DOM style (not React `height` state).
 * Measuring at a fixed min-height while overflow is hidden makes scrollHeight lie
 * (stuck at one line). Reset to `auto` first, then apply the measured pixel height.
 */
function measureAndApplyTextareaHeight(
  el: HTMLTextAreaElement,
  minPx: number,
  maxPx: number
): void {
  el.style.height = "auto";
  el.style.overflowY = "hidden";
  const scroll = el.scrollHeight;
  const next = Math.max(minPx, Math.min(scroll, maxPx));
  el.style.height = `${next}px`;
  el.style.overflowY = scroll > maxPx ? "auto" : "hidden";
}

function useComposerTextareaSync(
  inputRef: React.RefObject<HTMLTextAreaElement | null>,
  value: string,
  minPx: number,
  maxPx: number
): (el: HTMLTextAreaElement | null) => void {
  const sync = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (!el) return;
      measureAndApplyTextareaHeight(el, minPx, maxPx);
    },
    [minPx, maxPx]
  );

  useLayoutEffect(() => {
    sync(inputRef.current);
  }, [value, sync, inputRef]);

  return sync;
}

function themeTextareaStyle(variant: ShellComposerVariant, theme: PersonaUiThemeV2): CSSProperties {
  if (variant === "terminal") {
    return {
      background: "transparent",
      border: "none",
      color: "var(--lim-text, #c8d4e0)",
      fontFamily: "var(--lim-font-mono, Consolas, monospace)",
      fontSize: 13,
      lineHeight: 1.5,
      padding: "6px 0",
      letterSpacing: "0.02em",
    };
  }
  if (variant === "minimal") {
    return {
      background: "transparent",
      border: "none",
      color: "var(--lim-text, #c8d4e0)",
      fontFamily: "var(--lim-font-body, system-ui)",
      fontSize: 14,
      lineHeight: 1.55,
      padding: "10px 0",
    };
  }
  if (variant === "studio") {
    return {
      background: "transparent",
      border: "none",
      color: "var(--lim-text, #c8d4e0)",
      fontFamily: LIM.fontBody,
      fontSize: 14,
      lineHeight: 1.55,
      padding: "8px 4px",
    };
  }
  const themed = buildInputAreaStyle(theme);
  const { minHeight: _dropMin, ...rest } = themed;
  void _dropMin;
  return {
    ...rest,
    color: "var(--lim-text, #c8d4e0)",
    lineHeight: themed.lineHeight ?? 1.5,
    boxSizing: "border-box",
  };
}

function effectiveTextareaMin(
  variant: ShellComposerVariant,
  theme: PersonaUiThemeV2
): number {
  const base =
    variant === "terminal" ? 36 : variant === "studio" ? 44 : variant === "minimal" ? 44 : 48;
  if (variant === "hud") {
    const themed = buildInputAreaStyle(theme);
    const themeMin = typeof themed.minHeight === "number" ? themed.minHeight : 0;
    return Math.max(base, themeMin);
  }
  return base;
}

function AttachmentChips({
  contract,
  compact,
}: {
  contract: ShellContract;
  compact?: boolean;
}) {
  const { attachments, totalAttachmentKb, busy, onRemoveAttachment } = contract;
  if (attachments.length === 0) return null;

  return (
    <div className="lim-composer-attachments" style={{ display: "flex", flexWrap: "wrap", gap: compact ? 6 : 8, alignItems: "center" }}>
      {attachments.map((attachment, idx) => (
        <div
          key={`${attachment.name}-${idx}`}
          className="lim-composer-attachment-chip"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: compact ? "2px 6px 2px 2px" : "3px 8px 3px 3px",
            borderRadius: compact ? 6 : 8,
            background: "rgba(var(--lim-accent-rgb),0.06)",
            border: "1px solid rgba(var(--lim-accent-rgb),0.14)",
          }}
        >
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            style={{
              width: compact ? 22 : 28,
              height: compact ? 22 : 28,
              objectFit: "cover",
              borderRadius: compact ? 4 : 6,
            }}
          />
          <span
            style={{
              fontSize: compact ? 10 : 11,
              color: LIM.textDim,
              fontFamily: "var(--lim-font-mono, monospace)",
              maxWidth: 140,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {attachment.name}
          </span>
          <button
            type="button"
            aria-label={`Remove ${attachment.name}`}
            disabled={busy}
            onClick={() => onRemoveAttachment(idx)}
            style={{
              background: "none",
              border: "none",
              color: LIM.textDim,
              cursor: busy ? "default" : "pointer",
              fontSize: 14,
              lineHeight: 1,
              padding: "0 4px",
              opacity: busy ? 0.4 : 0.85,
            }}
          >
            ×
          </button>
        </div>
      ))}
      <span style={{ fontSize: 10, color: "rgba(var(--lim-accent-rgb),0.35)", fontFamily: "var(--lim-font-mono, monospace)" }}>
        {attachments.length} image{attachments.length === 1 ? "" : "s"} · {totalAttachmentKb} KB
      </span>
    </div>
  );
}

function SendButton({
  canSend,
  busy,
  variant,
  label,
}: {
  canSend: boolean;
  busy: boolean;
  variant: ShellComposerVariant;
  label?: string;
}) {
  const mono = variant === "hud" || variant === "terminal";
  const text = label ?? (mono ? "SEND" : "Send");

  if (variant === "studio") {
    return (
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send message"
        style={{
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: `1px solid ${canSend ? "rgba(var(--lim-accent-rgb),0.45)" : "rgba(var(--lim-accent-rgb),0.1)"}`,
          background: canSend ? "rgba(var(--lim-accent-rgb),0.18)" : "rgba(var(--lim-accent-rgb),0.04)",
          color: canSend ? CYAN : "rgba(var(--lim-accent-rgb),0.25)",
          cursor: canSend ? "pointer" : "default",
          fontSize: 18,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        ↑
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={!canSend}
      style={{
        flexShrink: 0,
        border: `1px solid ${canSend ? "rgba(var(--lim-accent-rgb),0.4)" : "rgba(var(--lim-accent-rgb),0.08)"}`,
        borderRadius: mono ? 3 : 10,
        color: canSend ? CYAN : "rgba(var(--lim-accent-rgb),0.2)",
        padding: mono ? "8px 16px" : "8px 18px",
        cursor: canSend ? "pointer" : "default",
        background: canSend ? "rgba(var(--lim-accent-rgb),0.12)" : LIM.surface1,
        fontFamily: mono ? "var(--lim-font-mono, monospace)" : "var(--lim-font-body, system-ui)",
        letterSpacing: mono ? "0.1em" : "0.02em",
        fontSize: mono ? 11 : 13,
        fontWeight: mono ? 400 : 600,
      }}
    >
      {busy ? "…" : text}
    </button>
  );
}

/**
 * Unified message composer — textarea, dictation, attachments, send/abort.
 * Every persona shell should use this instead of hand-rolled input forms.
 */
export function ShellComposer({
  contract,
  personaTheme,
  variant,
  wrapperStyle,
}: {
  contract: ShellContract;
  personaTheme: PersonaUiThemeV2;
  variant: ShellComposerVariant;
  /** Extra style on outer form/wrapper (e.g. studio floating card padding). */
  wrapperStyle?: React.CSSProperties;
}) {
  const theme = migratePersonaUiTheme(personaTheme);
  const inputRef = useRef<HTMLTextAreaElement | null>(null) as React.MutableRefObject<
    HTMLTextAreaElement | null
  >;
  const minHeight = effectiveTextareaMin(variant, theme);
  const maxHeight = variant === "terminal" ? 160 : variant === "studio" ? 220 : 200;
  const syncTextareaHeight = useComposerTextareaSync(
    inputRef,
    contract.input,
    minHeight,
    maxHeight
  );

  const { dictationProps, autoSendNotice, dismissAutoSendNotice } = useComposerDictation({
    input: contract.input,
    onInputChange: contract.onInputChange,
    inputRef,
    audioCue: contract.dictationAudioCue,
    onDictationSessionActive: contract.onDictationSessionActive,
    onCaptureActiveChange: contract.onDictationCaptureActive,
    shouldBlockSpeechCapture: contract.shouldBlockDictationCapture,
    onUnlockAudio: contract.onUnlockSpeechAudio,
    onAutoSendSubmit: contract.onDictationAutoSend,
    onHistoryReset: contract.onDictationHistoryReset,
  });

  const {
    input,
    busy,
    canSend,
    isDragOver,
    attachError,
    contextSnapshot,
    pct,
    onSubmit,
    onKeyDown,
    onPaste,
    onDragOver,
    onDragLeave,
    onDrop,
    onAbortTurn,
  } = contract;

  const mono = variant === "hud" || variant === "terminal";
  const placeholder =
    busy
      ? variant === "terminal"
        ? "processing…"
        : "Processing…"
      : variant === "hud"
        ? "Message the agent…"
        : variant === "terminal"
          ? "transmit_"
          : variant === "minimal"
            ? "Write a message…"
            : "Message…";

  const hintLine =
    variant === "terminal"
      ? "Enter · Shift+Enter newline · paste/drop images"
      : variant === "hud"
        ? "Enter send · Shift+Enter newline · paste/drop images · Ctrl/Cmd+K clear · Ctrl/Cmd+Shift+L new session"
        : "Enter send · Shift+Enter newline · paste or drop images";

  const dockStyle: React.CSSProperties =
    variant === "terminal"
      ? {
          flexShrink: 0,
          background: "rgba(0,2,6,0.97)",
          borderTop: "1px solid rgba(var(--lim-accent-rgb),0.1)",
          padding: "10px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          position: "relative",
          outline: isDragOver ? `1px dashed ${CYAN}` : undefined,
          ...wrapperStyle,
        }
      : variant === "studio"
      ? {
          background: "rgba(10,16,28,0.92)",
          borderRadius: 16,
          boxShadow: "0 4px 32px rgba(0,0,0,0.35), 0 0 0 1px rgba(var(--lim-accent-rgb),0.1)",
          padding: "12px 14px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          position: "relative",
          ...wrapperStyle,
        }
      : variant === "minimal"
        ? {
            flexShrink: 0,
            padding: "0 24px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 8,
            position: "relative",
            ...wrapperStyle,
          }
        : {
            ...buildInputDockStyle(theme),
            position: "relative",
            outline: isDragOver ? "1px dashed rgba(var(--lim-accent-rgb),0.45)" : undefined,
            borderTopColor: isDragOver ? CYAN : undefined,
            gap: 10,
            ...wrapperStyle,
          };

  const textareaStyle: CSSProperties = {
    display: "block",
    width: "100%",
    boxSizing: "border-box",
    resize: "none",
    margin: 0,
    minHeight,
    maxHeight,
    height: "auto",
    overflowY: "hidden",
    flex: "none",
    caretColor: "var(--lim-accent, #00d4ff)",
    ...themeTextareaStyle(variant, theme),
  };

  const formInner = (
    <>
      {isDragOver && (
        <div
          className="lim-composer-drop-overlay"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 5,
            borderRadius: variant === "studio" ? 16 : 8,
            background: "rgba(var(--lim-accent-rgb),0.08)",
            border: "2px dashed rgba(var(--lim-accent-rgb),0.35)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontSize: 12,
            fontFamily: "var(--lim-font-mono, monospace)",
            color: CYAN,
            letterSpacing: "0.06em",
          }}
        >
          Drop images to attach
        </div>
      )}

      {autoSendNotice && (
        <button
          type="button"
          onClick={dismissAutoSendNotice}
          title="Dismiss"
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "6px 10px",
            background: "rgba(255,200,0,0.1)",
            color: "#ffc800",
            border: "1px solid rgba(255,200,0,0.35)",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "var(--lim-font-mono, monospace)",
            lineHeight: 1.4,
            cursor: "pointer",
          }}
        >
          {autoSendNotice}
        </button>
      )}

      <AttachmentChips contract={contract} compact={variant === "minimal"} />

      {attachError && (
        <div style={{ color: RED_ERR, fontSize: 11, fontFamily: mono ? "monospace" : "inherit" }}>{attachError}</div>
      )}

      <div
        className="lim-composer-input-row"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: variant === "studio" ? 10 : 8,
          position: "relative",
        }}
      >
        {variant === "terminal" && (
          <span
            style={{
              color: CYAN,
              fontWeight: 700,
              flexShrink: 0,
              lineHeight: `${minHeight}px`,
              fontSize: 14,
              userSelect: "none",
              fontFamily: "monospace",
            }}
          >
            &gt;
          </span>
        )}

        <div style={{ position: "relative", flexShrink: 0 }}>
          <DictationButton {...dictationProps} />
        </div>

        {(contract.ttsLastSpoken || contract.ttsPlayError) ? (
          <span
            className="lim-tts-caption"
            title={contract.ttsPlayError ?? contract.ttsLastSpoken ?? ""}
            aria-live="polite"
            style={{
              flexShrink: 1,
              minWidth: 0,
              maxWidth: 180,
              fontSize: 10,
              opacity: contract.ttsPlayError ? 0.9 : 0.65,
              color: contract.ttsPlayError ? "var(--lim-warn, #e8a838)" : undefined,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {contract.ttsPlayError ? `🔇 ${contract.ttsPlayError}` : `🔊 ${contract.ttsLastSpoken}`}
          </span>
        ) : null}

        <div
          className="lim-composer-field"
          style={{
            flex: 1,
            minWidth: 0,
            alignSelf: "stretch",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            ...(variant === "minimal"
              ? { borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.18)" }
              : {}),
          }}
        >
          <textarea
            id="chat-message-input"
            name="message"
            ref={(el) => {
              inputRef.current = el;
              syncTextareaHeight(el);
            }}
            rows={1}
            style={textareaStyle}
            value={input}
            onChange={(e) => {
              contract.onInputChange(e.target.value);
              syncTextareaHeight(e.currentTarget);
            }}
            onInput={(e) => syncTextareaHeight(e.currentTarget)}
            onKeyDown={(e) => void onKeyDown(e)}
            onPaste={(e) => void onPaste(e)}
            placeholder={placeholder}
            disabled={busy}
            aria-label="Message"
          />
        </div>

        <SendButton canSend={canSend} busy={busy} variant={variant} />

        {busy && onAbortTurn && (
          <button
            type="button"
            onClick={onAbortTurn}
            title="Abort current turn"
            style={{
              flexShrink: 0,
              border: "1px solid rgba(255,80,80,0.35)",
              borderRadius: mono ? 3 : 8,
              color: "#ff8888",
              padding: mono ? "8px 12px" : "8px 14px",
              cursor: "pointer",
              background: "rgba(40,0,0,0.45)",
              fontFamily: "var(--lim-font-mono, monospace)",
              letterSpacing: "0.06em",
              fontSize: mono ? 10 : 11,
            }}
          >
            {mono ? "ABORT" : "Abort"}
          </button>
        )}
      </div>

      <div
        className="lim-composer-hints"
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          fontSize: 10,
          color: "rgba(var(--lim-accent-rgb),0.28)",
          fontFamily: "var(--lim-font-mono, monospace)",
          letterSpacing: mono ? "0.03em" : "0.01em",
        }}
      >
        <span>{hintLine}</span>
        {contextSnapshot && variant !== "hud" && (
          <span style={{ color: pct >= 80 ? RED_ERR : "rgba(var(--lim-accent-rgb),0.35)", flexShrink: 0 }}>
            ctx {pct}%
          </span>
        )}
      </div>
    </>
  );

  if (variant === "studio") {
    return (
      <div style={{ flexShrink: 0, maxWidth: 720, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ padding: "0 24px 20px" }}>
          <form
            style={dockStyle}
            onSubmit={onSubmit}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {formInner}
          </form>
        </div>
        <BrowserDock />
        <TerminalDock />
      </div>
    );
  }

  return (
    <>
      <form
        style={dockStyle}
        onSubmit={onSubmit}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {formInner}
      </form>
      <BrowserDock />
      <TerminalDock />
    </>
  );
}
