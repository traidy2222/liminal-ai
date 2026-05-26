import React, { useState } from "react";
import { useChats } from "./useChats.js";
import { NewChatModal } from "./NewChatModal.js";

/**
 * Compact chat switcher for the app header. Renders:
 *   - The current chat's title + workspace path chip
 *   - A dropdown of all chats with active indicator
 *   - "New chat" button → NewChatModal
 *   - Per-chat delete (with confirm) when hovering a chat
 *
 * Memory continuity: the title surface intentionally mentions that memory is
 * shared — most users assume per-chat = isolated everything, but Phase 1 made
 * notes/persona/recipes user-global. Making this visible avoids surprise.
 */
export const ChatSwitcher: React.FC = () => {
  const { state, create, activate, remove } = useChats();
  const [open, setOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const activeChat = state.chats.find((c) => c.chatId === state.activeChatId);
  const activeLabel = activeChat?.title ?? "(no chat)";
  const activePath = activeChat
    ? activeChat.workspaceMode === "scratch"
      ? "scratch"
      : shortenPath(activeChat.workspaceRoot)
    : "";

  return (
    <>
      <div style={{ position: "relative", display: "inline-block" }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          title={activeChat ? `${activeChat.title}\n${activeChat.workspaceRoot}` : "No active chat"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 9px",
            fontSize: 11,
            fontFamily: "system-ui, sans-serif",
            background: "rgba(var(--lim-accent-rgb, 0,212,255),0.08)",
            color: "var(--lim-fg, #d9e2ec)",
            border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.22)",
            borderRadius: 3,
            cursor: "pointer",
            maxWidth: 260,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          <span style={{ fontWeight: 600 }}>{activeLabel}</span>
          {activePath && (
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
        </button>

        {open && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 4px)",
              left: 0,
              minWidth: 320,
              maxHeight: "60vh",
              overflowY: "auto",
              background: "var(--lim-bg, #0c1117)",
              border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.25)",
              borderRadius: 4,
              boxShadow: "0 8px 24px rgba(0,0,0,0.55)",
              zIndex: 1000,
              padding: 4,
            }}
            onMouseLeave={() => {
              setOpen(false);
              setConfirmDelete(null);
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "6px 10px",
                fontSize: 9,
                letterSpacing: "0.16em",
                fontWeight: 700,
                color: "rgba(var(--lim-accent-rgb, 0,212,255),0.5)",
                fontFamily: "monospace",
              }}
            >
              <span>CHATS · {state.chats.length}</span>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setModalOpen(true);
                }}
                style={{
                  padding: "3px 8px",
                  fontSize: 10,
                  fontWeight: 600,
                  background: "var(--lim-accent, #00d4ff)",
                  color: "#001218",
                  border: "none",
                  borderRadius: 3,
                  cursor: "pointer",
                }}
              >
                + new
              </button>
            </div>

            {state.loading && (
              <div style={{ padding: 10, fontSize: 11, color: "rgba(217,226,236,0.5)" }}>Loading…</div>
            )}
            {state.error && (
              <div style={{ padding: 10, fontSize: 11, color: "#ff8888" }}>{state.error}</div>
            )}
            {state.chats.map((chat) => {
              const isActive = chat.chatId === state.activeChatId;
              const isResident = state.residentChatIds.includes(chat.chatId);
              const isConfirming = confirmDelete === chat.chatId;
              return (
                <div
                  key={chat.chatId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    fontSize: 12,
                    borderRadius: 3,
                    cursor: isActive ? "default" : "pointer",
                    background: isActive
                      ? "rgba(var(--lim-accent-rgb, 0,212,255),0.14)"
                      : "transparent",
                    borderLeft: isActive
                      ? "2px solid var(--lim-accent, #00d4ff)"
                      : "2px solid transparent",
                  }}
                  onClick={async () => {
                    if (isActive || busy) return;
                    setBusy(true);
                    try {
                      await activate(chat.chatId);
                    } finally {
                      setBusy(false);
                      setOpen(false);
                    }
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        fontWeight: isActive ? 600 : 400,
                        color: isActive ? "var(--lim-accent, #00d4ff)" : "inherit",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {chat.title}
                      {isResident && !isActive && (
                        <span
                          title="Loaded in memory"
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: 4,
                            background: "rgba(255,255,255,0.35)",
                          }}
                        />
                      )}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "rgba(217,226,236,0.45)",
                        fontFamily: "monospace",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {chat.workspaceMode === "scratch"
                        ? "scratch"
                        : shortenPath(chat.workspaceRoot)}
                    </div>
                  </div>
                  {isConfirming ? (
                    <div style={{ display: "flex", gap: 4 }}>
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
                          padding: "2px 7px",
                          fontSize: 10,
                          background: "rgba(255,68,68,0.18)",
                          color: "#ff8888",
                          border: "1px solid rgba(255,68,68,0.4)",
                          borderRadius: 3,
                          cursor: "pointer",
                        }}
                      >
                        confirm
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDelete(null);
                        }}
                        style={{
                          padding: "2px 7px",
                          fontSize: 10,
                          background: "transparent",
                          color: "rgba(217,226,236,0.55)",
                          border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.15)",
                          borderRadius: 3,
                          cursor: "pointer",
                        }}
                      >
                        no
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
                        padding: "1px 6px",
                        fontSize: 11,
                        background: "transparent",
                        color: "rgba(217,226,236,0.35)",
                        border: "none",
                        cursor: "pointer",
                        opacity: 0.6,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
            <div
              style={{
                padding: "8px 10px 4px",
                fontSize: 10,
                color: "rgba(217,226,236,0.42)",
                borderTop: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.08)",
                marginTop: 4,
                lineHeight: 1.45,
              }}
            >
              Memory, persona, and recipes are shared across all chats.
            </div>
          </div>
        )}
      </div>

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

/** Shorten a path for the chip — keeps last two segments plus a leading "…/" when truncated. */
function shortenPath(p: string): string {
  if (!p) return "";
  const segments = p.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length <= 2) return p;
  return `…/${segments.slice(-2).join("/")}`;
}
