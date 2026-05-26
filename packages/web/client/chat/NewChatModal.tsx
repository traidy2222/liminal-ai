import React, { useState } from "react";

/**
 * Modal for creating a new chat. Three workspace modes:
 *   - Scratch: agent gets a fresh disposable workspace dir per chat
 *   - Folder: agent operates on a user-chosen absolute folder path
 *   - Reuse: clone another chat's workspace path (for "sibling" sessions)
 *
 * Folder picker note: browsers can't directly read filesystem paths without the
 * File System Access API, which doesn't return absolute paths. For the server
 * to operate on a folder it needs the absolute path, so we accept it as a text
 * input. Users paste from their file manager or terminal (`pwd`).
 */
export interface NewChatModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (input: {
    title?: string;
    workspaceMode: "scratch" | "folder" | "reuse";
    workspaceRoot?: string;
  }) => Promise<void>;
  /** Existing chats — surfaces a Reuse-from picker. */
  knownWorkspaces: Array<{ chatId: string; title: string; workspaceRoot: string }>;
}

export const NewChatModal: React.FC<NewChatModalProps> = ({
  open,
  onClose,
  onCreate,
  knownWorkspaces,
}) => {
  const [mode, setMode] = useState<"scratch" | "folder" | "reuse">("scratch");
  const [title, setTitle] = useState("");
  const [folderPath, setFolderPath] = useState("");
  const [reuseFromId, setReuseFromId] = useState<string>(knownWorkspaces[0]?.chatId ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async (): Promise<void> => {
    setError(null);
    setSubmitting(true);
    try {
      let workspaceRoot: string | undefined;
      if (mode === "folder") {
        const path = folderPath.trim();
        if (!path) {
          throw new Error("Folder path is required for folder mode.");
        }
        workspaceRoot = path;
      } else if (mode === "reuse") {
        const reuseChat = knownWorkspaces.find((c) => c.chatId === reuseFromId);
        if (!reuseChat) {
          throw new Error("Pick a chat to reuse the workspace from.");
        }
        workspaceRoot = reuseChat.workspaceRoot;
      }
      await onCreate({
        title: title.trim() || undefined,
        workspaceMode: mode,
        workspaceRoot,
      });
      setTitle("");
      setFolderPath("");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={() => !submitting && onClose()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "92vw",
          background: "var(--lim-bg, #0c1117)",
          color: "var(--lim-fg, #d9e2ec)",
          border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.25)",
          borderRadius: 8,
          padding: 20,
          boxShadow: "0 16px 48px rgba(0,0,0,0.7)",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: "0.04em" }}>
          New chat
        </h2>
        <p style={{ fontSize: 12, color: "rgba(217,226,236,0.6)", marginTop: 4, marginBottom: 16 }}>
          Memories, persona, and learned recipes carry across every chat. The workspace mode only
          decides where this chat&apos;s files land.
        </p>

        <label style={{ display: "block", fontSize: 11, marginBottom: 4, color: "rgba(217,226,236,0.7)" }}>
          Title (optional)
        </label>
        <input
          type="text"
          placeholder="e.g. dreamthedream refactor"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          disabled={submitting}
          style={{
            width: "100%",
            padding: "8px 10px",
            fontSize: 13,
            background: "rgba(255,255,255,0.04)",
            color: "inherit",
            border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.18)",
            borderRadius: 4,
            marginBottom: 14,
            boxSizing: "border-box",
          }}
        />

        <label style={{ display: "block", fontSize: 11, marginBottom: 6, color: "rgba(217,226,236,0.7)" }}>
          Workspace
        </label>
        <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {(["scratch", "folder", "reuse"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              disabled={submitting}
              style={{
                flex: 1,
                padding: "7px 0",
                fontSize: 12,
                textTransform: "capitalize",
                cursor: submitting ? "default" : "pointer",
                background:
                  mode === m
                    ? "rgba(var(--lim-accent-rgb, 0,212,255),0.22)"
                    : "rgba(255,255,255,0.03)",
                border:
                  mode === m
                    ? "1px solid var(--lim-accent, #00d4ff)"
                    : "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.15)",
                color: mode === m ? "var(--lim-accent, #00d4ff)" : "inherit",
                borderRadius: 4,
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {m}
            </button>
          ))}
        </div>

        {mode === "scratch" && (
          <p
            style={{
              fontSize: 12,
              color: "rgba(217,226,236,0.55)",
              margin: "0 0 14px",
              lineHeight: 1.45,
            }}
          >
            A fresh workspace lives at <code>~/.liminal/chats/&lt;id&gt;/workspace/</code> and is
            removed when this chat is deleted. Best for one-off experiments and disposable builds.
          </p>
        )}

        {mode === "folder" && (
          <>
            <label
              style={{
                display: "block",
                fontSize: 11,
                marginBottom: 4,
                color: "rgba(217,226,236,0.7)",
              }}
            >
              Absolute folder path
            </label>
            <input
              type="text"
              placeholder="/Users/you/projects/my-app"
              value={folderPath}
              onChange={(e) => setFolderPath(e.target.value)}
              disabled={submitting}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 13,
                fontFamily: "monospace",
                background: "rgba(255,255,255,0.04)",
                color: "inherit",
                border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.18)",
                borderRadius: 4,
                marginBottom: 8,
                boxSizing: "border-box",
              }}
            />
            <p
              style={{
                fontSize: 11,
                color: "rgba(217,226,236,0.45)",
                margin: "0 0 14px",
                lineHeight: 1.4,
              }}
            >
              The agent operates on this folder. We never write <code>.agent_*</code> files inside
              it — all harness state lives under <code>~/.liminal/</code>.
            </p>
          </>
        )}

        {mode === "reuse" && (
          <>
            <label
              style={{
                display: "block",
                fontSize: 11,
                marginBottom: 4,
                color: "rgba(217,226,236,0.7)",
              }}
            >
              Reuse workspace from
            </label>
            {knownWorkspaces.length === 0 ? (
              <p style={{ fontSize: 12, color: "rgba(217,226,236,0.55)", margin: "0 0 14px" }}>
                No other chats yet. Create a folder or scratch chat first.
              </p>
            ) : (
              <select
                value={reuseFromId}
                onChange={(e) => setReuseFromId(e.target.value)}
                disabled={submitting}
                style={{
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: 13,
                  background: "rgba(255,255,255,0.04)",
                  color: "inherit",
                  border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.18)",
                  borderRadius: 4,
                  marginBottom: 14,
                  boxSizing: "border-box",
                }}
              >
                {knownWorkspaces.map((c) => (
                  <option key={c.chatId} value={c.chatId}>
                    {c.title} · {c.workspaceRoot}
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {error && (
          <div
            style={{
              padding: "6px 10px",
              borderRadius: 4,
              background: "rgba(255,68,68,0.12)",
              border: "1px solid rgba(255,68,68,0.4)",
              color: "#ff8888",
              fontSize: 12,
              marginBottom: 12,
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: "7px 14px",
              fontSize: 12,
              background: "transparent",
              color: "inherit",
              border: "1px solid rgba(var(--lim-accent-rgb, 0,212,255),0.15)",
              borderRadius: 4,
              cursor: submitting ? "default" : "pointer",
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            style={{
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 600,
              background: "var(--lim-accent, #00d4ff)",
              color: "#001218",
              border: "none",
              borderRadius: 4,
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.6 : 1,
            }}
          >
            {submitting ? "Creating…" : "Create chat"}
          </button>
        </div>
      </div>
    </div>
  );
};
