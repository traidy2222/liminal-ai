import React, { useCallback, useEffect, useState } from "react";
import { useChats } from "../chat/useChats.js";
import { webApiFetch } from "../webApiAuth.js";
import { GhosttyTerminal } from "./GhosttyTerminal.js";
import { PanelResizeHandle } from "./PanelResizeHandle.js";
import type { TerminalTab, TerminalViewWire } from "./terminalTypes.js";

function defaultTerminalHeight(): number {
  if (typeof window === "undefined") return 280;
  return Math.round(Math.min(Math.max(window.innerHeight * 0.28, 160), 520));
}

function terminalHeightBounds(): { min: number; max: number } {
  if (typeof window === "undefined") return { min: 120, max: 520 };
  return { min: 120, max: Math.round(window.innerHeight * 0.65) };
}

/** Collapsible per-chat terminal panel with multi-tab support (agent + user shells). */
export function TerminalDock() {
  const { state } = useChats();
  const [open, setOpen] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(defaultTerminalHeight);
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const chatId = state.activeChatId;

  const upsertTab = useCallback((wire: TerminalViewWire) => {
    if (!wire.open) {
      setTabs((prev) => {
        const next = prev.filter((t) => t.sessionId !== wire.sessionId);
        setActiveSessionId((cur) => {
          if (cur !== wire.sessionId) return cur;
          return next.length > 0 ? next[next.length - 1]!.sessionId : null;
        });
        if (next.length === 0) setOpen(false);
        return next;
      });
      return;
    }
    const tab: TerminalTab = {
      sessionId: wire.sessionId,
      label: wire.label || "Terminal",
      cwd: wire.cwd,
      source: wire.source,
    };
    setTabs((prev) => {
      const idx = prev.findIndex((t) => t.sessionId === tab.sessionId);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx]!, ...tab };
        return next;
      }
      return [...prev, tab];
    });
    if (wire.focus) {
      setActiveSessionId(wire.sessionId);
      setOpen(true);
    } else {
      setActiveSessionId((cur) => cur ?? wire.sessionId);
    }
  }, []);

  useEffect(() => {
    if (!chatId) return;
    setTabs([]);
    setActiveSessionId(null);
    setOpen(false);
  }, [chatId]);

  useEffect(() => {
    const onView = (ev: Event) => {
      const detail = (ev as CustomEvent<TerminalViewWire>).detail;
      if (!detail || detail.chatId !== chatId) return;
      upsertTab(detail);
    };
    const onExit = (ev: Event) => {
      const detail = (ev as CustomEvent<{ chatId: string; sessionId: string }>).detail;
      if (!detail || detail.chatId !== chatId) return;
      setTabs((prev) => {
        const next = prev.filter((t) => t.sessionId !== detail.sessionId);
        setActiveSessionId((cur) => {
          if (cur !== detail.sessionId) return cur;
          return next.length > 0 ? next[next.length - 1]!.sessionId : null;
        });
        if (next.length === 0) setOpen(false);
        return next;
      });
    };
    window.addEventListener("liminal:terminal_view", onView);
    window.addEventListener("liminal:pty_exit", onExit);
    return () => {
      window.removeEventListener("liminal:terminal_view", onView);
      window.removeEventListener("liminal:pty_exit", onExit);
    };
  }, [chatId, upsertTab]);

  const onResizeHeight = useCallback((delta: number) => {
    const { min, max } = terminalHeightBounds();
    setBodyHeight((h) => Math.min(max, Math.max(min, h + delta)));
  }, []);

  const openUserTab = useCallback(async () => {
    if (!chatId) return;
    const res = await webApiFetch("/api/pty/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        source: "user",
        forceNew: tabs.length > 0,
      }),
    });
    const body = (await res.json()) as {
      error?: string;
      sessionId?: string;
      label?: string;
      cwd?: string;
      source?: TerminalTab["source"];
    };
    if (!res.ok || !body.sessionId) return;
    upsertTab({
      chatId,
      sessionId: body.sessionId,
      label: body.label ?? "Terminal",
      cwd: body.cwd ?? "",
      source: body.source ?? "user",
      open: true,
      focus: true,
      updatedAt: Date.now(),
    });
    setOpen(true);
  }, [chatId, tabs.length, upsertTab]);

  const closeTab = useCallback(
    async (sessionId: string) => {
      await webApiFetch("/api/pty/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      setTabs((prev) => {
        const next = prev.filter((t) => t.sessionId !== sessionId);
        setActiveSessionId((cur) => {
          if (cur !== sessionId) return cur;
          return next.length > 0 ? next[next.length - 1]!.sessionId : null;
        });
        if (next.length === 0) setOpen(false);
        return next;
      });
    },
    []
  );

  if (!chatId) return null;

  const activeTab = tabs.find((t) => t.sessionId === activeSessionId) ?? tabs[0] ?? null;
  const hasTabs = tabs.length > 0;

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid rgba(var(--lim-accent-rgb),0.2)",
        background: "rgba(2,6,14,0.98)",
      }}
    >
      {open ? (
        <PanelResizeHandle axis="vertical" onDragDelta={onResizeHeight} />
      ) : null}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 8px",
          background: "rgba(0,8,18,0.9)",
          borderBottom: open ? "1px solid rgba(var(--lim-accent-rgb),0.12)" : "none",
        }}
      >
        <button
          type="button"
          onClick={() => (hasTabs ? setOpen((v) => !v) : void openUserTab())}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 8px",
            background: "transparent",
            border: "none",
            color: "rgba(var(--lim-accent-rgb),0.7)",
            fontFamily: "var(--lim-font-mono, monospace)",
            fontSize: 11,
            letterSpacing: "0.08em",
            cursor: "pointer",
          }}
        >
          <span>{open ? "▼" : "▲"} TERMINAL</span>
          {hasTabs ? (
            <span style={{ opacity: 0.5, fontSize: 10 }}>{tabs.length}</span>
          ) : (
            <span style={{ opacity: 0.5, fontSize: 10 }}>open shell</span>
          )}
        </button>
        {hasTabs ? (
          <div style={{ display: "flex", flex: 1, gap: 2, overflow: "auto", minWidth: 0 }}>
            {tabs.map((tab) => {
              const selected = tab.sessionId === activeTab?.sessionId;
              return (
                <button
                  key={tab.sessionId}
                  type="button"
                  onClick={() => {
                    setActiveSessionId(tab.sessionId);
                    setOpen(true);
                  }}
                  title={tab.cwd}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    padding: "2px 8px",
                    maxWidth: 160,
                    background: selected
                      ? "rgba(var(--lim-accent-rgb),0.15)"
                      : "rgba(var(--lim-accent-rgb),0.05)",
                    border: `1px solid rgba(var(--lim-accent-rgb),${selected ? 0.35 : 0.12})`,
                    borderRadius: 4,
                    color: "rgba(var(--lim-accent-rgb),0.85)",
                    fontFamily: "var(--lim-font-mono, monospace)",
                    fontSize: 10,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {tab.label}
                  </span>
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      void closeTab(tab.sessionId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        void closeTab(tab.sessionId);
                      }
                    }}
                    style={{ opacity: 0.6, fontSize: 12, lineHeight: 1 }}
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <div style={{ flex: 1 }} />
        )}
        <button
          type="button"
          onClick={() => void openUserTab()}
          title="New terminal tab"
          style={{
            padding: "2px 8px",
            background: "rgba(var(--lim-accent-rgb),0.08)",
            border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
            borderRadius: 4,
            color: "rgba(var(--lim-accent-rgb),0.75)",
            fontFamily: "var(--lim-font-mono, monospace)",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          +
        </button>
      </div>
      {open && activeTab ? (
        <GhosttyTerminal
          key={activeTab.sessionId}
          chatId={chatId}
          sessionId={activeTab.sessionId}
          active={open}
          bodyHeightPx={bodyHeight}
          closeOnUnmount={false}
        />
      ) : null}
    </div>
  );
}
