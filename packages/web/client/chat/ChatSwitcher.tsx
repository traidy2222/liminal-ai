import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useChats } from "./useChats.js";
import { NewChatModal } from "./NewChatModal.js";
import { useDismissOnOutside } from "./useDismissOnOutside.js";

export type ChatSwitcherLayout = "inline" | "compact";

export interface ChatSwitcherProps {
  /** `inline` = one-line control inside shell chrome. `compact` = small chip. */
  layout?: ChatSwitcherLayout;
}

/**
 * Chat switcher: current chat title, workspace path, list of chats, new chat.
 * Memory continuity hint is inside the menu (notes/persona/recipes are user-global).
 */
export const ChatSwitcher: React.FC<ChatSwitcherProps> = ({ layout = "inline" }) => {
  const { state, create, activate, remove } = useChats();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});

  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const dismiss = useCallback(() => {
    setOpen(false);
    setConfirmDelete(null);
  }, []);

  useDismissOnOutside(open, [rootRef, menuRef], dismiss);

  const activeChat = state.chats.find((c) => c.chatId === state.activeChatId);
  const activeLabel = activeChat?.title ?? "No chat selected";
  const activePath = activeChat
    ? activeChat.workspaceMode === "scratch"
      ? "scratch"
      : shortenPath(activeChat.workspaceRoot)
    : "";

  const isInline = layout === "inline";

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    const updatePosition = () => {
      const rect = triggerRef.current!.getBoundingClientRect();
      const margin = 8;
      const menuWidth = Math.min(360, Math.max(rect.width, 260));
      let left = rect.left;
      if (left + menuWidth > window.innerWidth - margin) {
        left = window.innerWidth - menuWidth - margin;
      }
      left = Math.max(margin, left);

      const spaceBelow = window.innerHeight - rect.bottom - margin;
      const spaceAbove = rect.top - margin;
      const preferBelow = spaceBelow >= 200 || spaceBelow >= spaceAbove;
      const maxHeight = Math.min(480, Math.max(160, preferBelow ? spaceBelow - 6 : spaceAbove - 6));

      setMenuStyle({
        position: "fixed",
        left,
        width: menuWidth,
        maxHeight,
        top: preferBelow ? rect.bottom + 6 : undefined,
        bottom: preferBelow ? undefined : window.innerHeight - rect.top + 6,
        zIndex: 12000,
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, activeLabel, activePath]);

  const triggerStyle: React.CSSProperties = isInline
    ? {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        maxWidth: "min(520px, 72vw)",
        height: 22,
        padding: "0 6px 0 4px",
        fontSize: 11,
        lineHeight: 1,
        fontFamily: "var(--lim-font-mono, Consolas, monospace)",
        background: open ? "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.08)" : "transparent",
        color: "var(--lim-fg, #d9e2ec)",
        border: "none",
        borderRadius: 4,
        cursor: busy ? "wait" : "pointer",
        textAlign: "left",
        transition: "background 0.12s",
      }
    : {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 9px",
        fontSize: 11,
        fontFamily: "system-ui, sans-serif",
        background: "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.08)",
        color: "var(--lim-fg, #d9e2ec)",
        border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.22)",
        borderRadius: 3,
        cursor: "pointer",
        maxWidth: 260,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
      };

  const menu = open ? (
    <div
      ref={menuRef}
      role="listbox"
      aria-label="Chats"
      style={{
        ...menuStyle,
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        background: "var(--lim-bg, #0c1117)",
        border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.22)",
        borderRadius: 6,
        boxShadow: "0 10px 28px rgba(0, 0, 0, 0.45)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "5px 8px",
          flexShrink: 0,
          borderBottom: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.08)",
        }}
      >
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.12em",
            fontWeight: 600,
            color: "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.45)",
            fontFamily: "var(--lim-font-mono, Consolas, monospace)",
          }}
        >
          {state.chats.length} chats
        </span>
        <button
          type="button"
          onClick={() => {
            dismiss();
            setModalOpen(true);
          }}
          style={{
            padding: "2px 8px",
            fontSize: 10,
            fontWeight: 600,
            background: "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.14)",
            color: "var(--lim-accent, #00d4ff)",
            border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.25)",
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          + new
        </button>
      </div>

      <div style={{ overflowY: "auto", flex: 1, padding: "3px 4px" }}>
        {state.loading && (
          <div style={{ padding: 12, fontSize: 11, color: "rgba(217,226,236,0.5)" }}>Loading…</div>
        )}
        {state.error && (
          <div style={{ padding: 12, fontSize: 11, color: "#ff8888" }}>{state.error}</div>
        )}
        {state.chats.map((chat) => {
          const isActive = chat.chatId === state.activeChatId;
          const isResident = state.residentChatIds.includes(chat.chatId);
          const isConfirming = confirmDelete === chat.chatId;
          return (
            <div
              key={chat.chatId}
              role="option"
              aria-selected={isActive}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 6,
                padding: "4px 6px",
                fontSize: 11,
                borderRadius: 4,
                cursor: isActive ? "default" : "pointer",
                background: isActive
                  ? "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.1)"
                  : "transparent",
                marginBottom: 1,
              }}
              onClick={async () => {
                if (isActive || busy) return;
                setBusy(true);
                try {
                  await activate(chat.chatId);
                } finally {
                  setBusy(false);
                  dismiss();
                }
              }}
            >
              <div
                style={{
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: isActive ? 600 : 400,
                  color: isActive ? "var(--lim-accent, #00d4ff)" : "rgba(217,226,236,0.88)",
                }}
                title={`${chat.title}\n${chat.workspaceRoot}`}
              >
                <span>{chat.title}</span>
                <span style={{ color: "rgba(217,226,236,0.38)", fontWeight: 400 }}>
                  {" · "}
                  {chat.workspaceMode === "scratch" ? "scratch" : shortenPath(chat.workspaceRoot)}
                </span>
                {isResident && !isActive && (
                  <span
                    title="Loaded in memory"
                    style={{
                      display: "inline-block",
                      width: 4,
                      height: 4,
                      marginLeft: 4,
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.3)",
                      verticalAlign: "middle",
                    }}
                  />
                )}
              </div>
              {isConfirming ? (
                <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      setBusy(true);
                      try {
                        await remove(chat.chatId);
                      } finally {
                        setBusy(false);
                        setConfirmDelete(null);
                      }
                    }}
                    style={{
                      padding: "3px 8px",
                      fontSize: 10,
                      background: "rgba(255,68,68,0.18)",
                      color: "#ff8888",
                      border: "1px solid rgba(255,68,68,0.4)",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setConfirmDelete(null);
                    }}
                    style={{
                      padding: "3px 8px",
                      fontSize: 10,
                      background: "transparent",
                      color: "rgba(217,226,236,0.55)",
                      border: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.15)",
                      borderRadius: 4,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDelete(chat.chatId);
                  }}
                  title="Delete chat"
                  style={{
                    padding: "2px 8px",
                    fontSize: 11,
                    background: "transparent",
                    color: "rgba(217,226,236,0.35)",
                    border: "none",
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: "5px 8px 6px",
          fontSize: 9,
          color: "rgba(217,226,236,0.35)",
          borderTop: "1px solid rgba(var(--lim-accent-rgb, 0, 212, 255), 0.06)",
          lineHeight: 1.35,
          flexShrink: 0,
        }}
      >
        Memory & persona shared across chats.
      </div>
    </div>
  ) : null;

  return (
    <>
      <div
        ref={rootRef}
        style={{
          position: "relative",
          display: "inline-block",
          maxWidth: isInline ? "100%" : undefined,
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          aria-expanded={open}
          aria-haspopup="listbox"
          title={activeChat ? `${activeChat.title}\n${activeChat.workspaceRoot}` : "Select a chat"}
          style={triggerStyle}
        >
          {isInline ? (
            <>
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontWeight: 600,
                  color: "var(--lim-accent, #00d4ff)",
                }}
              >
                {activeLabel}
              </span>
              {activePath ? (
                <>
                  <span style={{ color: "rgba(217,226,236,0.25)", flexShrink: 0 }}>·</span>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: "rgba(217,226,236,0.42)",
                      fontWeight: 400,
                    }}
                  >
                    {activePath}
                  </span>
                </>
              ) : null}
              <span
                style={{
                  flexShrink: 0,
                  color: "rgba(var(--lim-accent-rgb, 0, 212, 255), 0.55)",
                  fontSize: 9,
                  marginLeft: 2,
                  transform: open ? "rotate(180deg)" : "none",
                  transition: "transform 0.12s",
                }}
                aria-hidden
              >
                ▾
              </span>
            </>
          ) : (
            <>
              <span style={{ fontWeight: 600 }}>{activeLabel}</span>
              {activePath && activeChat && (
                <span
                  style={{
                    color: "rgba(217,226,236,0.55)",
                    fontFamily: "monospace",
                    fontSize: 10,
                  }}
                >
                  · {activePath}
                </span>
              )}
              <span style={{ color: "var(--lim-accent, #00d4ff)", marginLeft: 2 }}>▾</span>
            </>
          )}
        </button>
      </div>

      {menu && createPortal(menu, document.body)}

      <NewChatModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreate={async (input) => {
          await create(input);
        }}
        knownWorkspaces={state.chats.map((c) => ({
          chatId: c.chatId,
          title: c.title,
          workspaceRoot: c.workspaceRoot,
        }))}
      />
    </>
  );
};

function shortenPath(p: string): string {
  if (!p) return "";
  const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 2) return p;
  return `…/${segments.slice(-2).join("/")}`;
}
