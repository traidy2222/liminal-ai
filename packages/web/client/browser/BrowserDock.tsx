import React, { useCallback, useEffect, useRef, useState } from "react";
import { webApiFetch, webApiStreamUrl } from "../webApiAuth.js";
import { PanelResizeHandle } from "../terminal/PanelResizeHandle.js";
import { useChats } from "../chat/useChats.js";

export type BrowserViewWire = {
  chatId?: string;
  sessionId: string;
  url: string;
  title?: string;
  open: boolean;
  updatedAt: number;
  viewportWidth?: number;
  viewportHeight?: number;
  liveStream?: boolean;
  embedMode?: "webview" | "screencast";
};

function defaultBrowserHeight(): number {
  if (typeof window === "undefined") return 320;
  return Math.round(Math.min(Math.max(window.innerHeight * 0.32, 180), 560));
}

function browserHeightBounds(): { min: number; max: number } {
  if (typeof window === "undefined") return { min: 140, max: 560 };
  return { min: 140, max: Math.round(window.innerHeight * 0.65) };
}

function mapToViewport(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  viewportWidth: number,
  viewportHeight: number
): { x: number; y: number } | null {
  const scale = Math.min(rect.width / viewportWidth, rect.height / viewportHeight);
  const drawW = viewportWidth * scale;
  const drawH = viewportHeight * scale;
  const offsetX = rect.left + (rect.width - drawW) / 2;
  const offsetY = rect.top + (rect.height - drawH) / 2;
  if (
    clientX < offsetX ||
    clientY < offsetY ||
    clientX > offsetX + drawW ||
    clientY > offsetY + drawH
  ) {
    return null;
  }
  return {
    x: Math.round(((clientX - offsetX) / drawW) * viewportWidth),
    y: Math.round(((clientY - offsetY) / drawH) * viewportHeight),
  };
}

function BrowserStreamPane({
  sessionId,
  viewportWidth,
  viewportHeight,
}: {
  sessionId: string;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const viewport = useRef({ width: viewportWidth, height: viewportHeight });
  const [status, setStatus] = useState<"connecting" | "live" | "error">("connecting");

  useEffect(() => {
    let disposed = false;
    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = webApiStreamUrl(
      `${wsProto}//${window.location.host}/api/browser/ws?sessionId=${encodeURIComponent(sessionId)}`
    );
    const ws = new WebSocket(wsUrl);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    ws.onopen = () => {
      if (!disposed) setStatus("live");
    };
    ws.onerror = () => {
      if (!disposed) setStatus("error");
    };
    ws.onclose = () => {
      if (!disposed) setStatus("error");
    };
    ws.onmessage = (ev) => {
      if (disposed) return;
      if (typeof ev.data === "string") {
        try {
          const meta = JSON.parse(ev.data) as { type?: string; url?: string; viewportWidth?: number; viewportHeight?: number };
          if (meta.viewportWidth && meta.viewportHeight) viewport.current = { width: meta.viewportWidth, height: meta.viewportHeight };
          if (meta.type === "meta" && meta.url && paneRef.current) {
            /* url shown in parent header */
          }
        } catch {
          /* ignore */
        }
        return;
      }
      const buf = ev.data instanceof ArrayBuffer ? ev.data : null;
      if (!buf || buf.byteLength < 64) return;
      const blob = new Blob([buf], { type: "image/jpeg" });
      const nextUrl = URL.createObjectURL(blob);
      const img = imgRef.current;
      if (img) img.src = nextUrl;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = nextUrl;
    };

    return () => {
      disposed = true;
      ws.close();
      wsRef.current = null;
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
    };
  }, [sessionId]);

  const sendInput = useCallback((payload: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify(payload));
  }, []);

  const onPointer = useCallback(
    (ev: React.PointerEvent<HTMLDivElement>) => {
      const pane = paneRef.current;
      if (!pane) return;
      const rect = pane.getBoundingClientRect();
      const pt = mapToViewport(ev.clientX, ev.clientY, rect, viewport.current.width, viewport.current.height);
      if (!pt) return;
      if (ev.type === "pointerdown" && ev.button === 0) {
        sendInput({
          type: "click",
          x: pt.x,
          y: pt.y,
          button: "left",
        });
      }
    },
    [sendInput, viewportWidth, viewportHeight]
  );

  const onWheel = useCallback(
    (ev: React.WheelEvent<HTMLDivElement>) => {
      ev.preventDefault();
      const pane = paneRef.current;
      if (!pane) return;
      const rect = pane.getBoundingClientRect();
      const pt = mapToViewport(ev.clientX, ev.clientY, rect, viewport.current.width, viewport.current.height);
      if (!pt) return;
      sendInput({
        type: "wheel",
        x: pt.x,
        y: pt.y,
        deltaX: ev.deltaX,
        deltaY: ev.deltaY,
      });
    },
    [sendInput, viewportWidth, viewportHeight]
  );

  return (
    <div
      ref={paneRef}
      style={{
        flex: 1,
        minHeight: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0a0f14",
        cursor: "crosshair",
        touchAction: "none",
        height: "100%",
        outline: "none",
      }}
      tabIndex={0}
      onPointerDown={event => { event.currentTarget.focus(); onPointer(event); }}
      onKeyDown={event => {
        if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return;
        if (event.key === "Tab" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v")) return;
        event.preventDefault();
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) sendInput({type: "type", text: event.key});
        else sendInput({type: "keydown", key: [event.ctrlKey ? "Control" : "", event.metaKey ? "Meta" : "", event.altKey ? "Alt" : "", event.shiftKey ? "Shift" : "", event.key === " " ? "Space" : event.key].filter(Boolean).join("+")});
      }}
      onPaste={event => { event.preventDefault(); sendInput({type: "type", text: event.clipboardData.getData("text/plain")}); }}
      onWheel={onWheel}
    >
      <img
        ref={imgRef}
        alt="Live browser"
        draggable={false}
        style={{
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
          userSelect: "none",
        }}
      />
      {status === "connecting" && (
        <div style={{ position: "absolute", color: "#8aa0b5", fontSize: 13 }}>Connecting…</div>
      )}
      {status === "error" && (
        <div style={{ position: "absolute", color: "#f07178", fontSize: 13 }}>
          Stream disconnected — still updates after agent browser steps
        </div>
      )}
    </div>
  );
}

type Tab = { sessionId: string; url: string; title: string; paused: boolean; suspended?: boolean };

/** App-level browser workspace. Always renders the agent's live page, never an iframe copy. */
export function BrowserDock() {
  const { state } = useChats();
  return state.activeChatId ? <ChatBrowserDock key={state.activeChatId} chatId={state.activeChatId} /> : null;
}

function ChatBrowserDock({ chatId }: { chatId: string }) {
  const [open, setOpen] = useState(false);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{url: string; title: string}[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(defaultBrowserHeight);
  const initialized = useRef(false);
  const lastState = useRef("");
  const refresh = useCallback(async () => {
    try {
      const response = await webApiFetch("/api/browser/control", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action: "state", chatId}) });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Browser unavailable");
      setError(null);
      const fingerprint = JSON.stringify(data);
      if (lastState.current === fingerprint) return;
      lastState.current = fingerprint;
      setTabs(data.tabs); setHistory(data.history || []);
      setSelected(data.selectedTabId ?? null);
    } catch (e) { setError(String(e)); }
  }, [chatId]);
  const command = useCallback(async (action: string, sessionId?: string, url?: string) => {
    try {
      const response = await webApiFetch("/api/browser/control", {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({action, sessionId, url, chatId})});
      const data = await response.json();
      if (!data.ok) throw new Error(data.error || "Browser command failed");
      if (data.sessionId) { setSelected(data.sessionId); setOpen(true); }
      setError(null); await refresh();
    } catch (e) { setError(String(e)); }
  }, [refresh, chatId]);
  useEffect(() => {
    // Restore once per mounted workspace; the server also deduplicates restoration.
    if (!initialized.current) { initialized.current = true; void command("restore"); }
    const timer = setInterval(() => { void refresh(); }, 10000);
    const onView = (event: Event) => {
      const view = (event as CustomEvent<BrowserViewWire>).detail;
      if (view?.chatId !== chatId) return;
      if (view?.open) { setSelected(view.sessionId); setOpen(true); }
      void refresh();
    };
    window.addEventListener("liminal:browser_view", onView);
    return () => { clearInterval(timer); window.removeEventListener("liminal:browser_view", onView); };
  }, [refresh, command, chatId]);
  const tab = tabs.find(t => t.sessionId === selected);
  useEffect(() => {
    if (open && tab?.suspended) void command("focus", tab.sessionId);
  }, [open, tab?.sessionId, tab?.suspended, command]);
  useEffect(() => { setAddress(tab?.url ?? ""); }, [tab?.url, selected]);
  const onResizeHeight = useCallback((delta: number) => {
    const {min, max} = browserHeightBounds(); setBodyHeight(h => Math.min(max, Math.max(min, h + delta)));
  }, []);
  const navigate = (event: React.FormEvent) => {
    event.preventDefault(); const raw = address.trim(); if (!raw) return;
    const url = raw.includes("://") ? raw : raw.includes(".") && !raw.includes(" ") ? `https://${raw}` : `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
    void command(tab ? "navigate" : "open", tab?.sessionId, url);
  };
  return <section aria-label="Liminal browser" style={{flexShrink: 0, borderTop: "1px solid var(--border, #34414d)", background: "var(--panel, #141b23)"}}>
    <div style={{display: "flex", gap: 8, padding: "6px 12px", alignItems: "center"}}>
      <button onClick={() => setOpen(!open)}>Browser · {tabs.length} tabs {open ? "▾" : "▸"}</button>
      <button onClick={() => {setOpen(true); void command("open");}} aria-label="New browser tab">＋ New tab</button>
      {tab && <span style={{flex: 1, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis"}}>{tab.title}</span>}
    </div>
    {open && <>
      <PanelResizeHandle axis="vertical" onDragDelta={onResizeHeight}/>
      <div role="tablist" style={{display: "flex", overflowX: "auto", gap: 4, padding: "4px 8px"}}>{tabs.map(t => <div key={t.sessionId} style={{display: "flex", flexShrink: 0}}>
        <button role="tab" aria-selected={t.sessionId === selected} onClick={() => {setSelected(t.sessionId); void command("focus", t.sessionId);}}>{t.title.slice(0, 30)}</button>
        <button aria-label={`Close ${t.title}`} onClick={() => {void command("close", t.sessionId);}}>×</button>
      </div>)}</div>
      <form onSubmit={navigate} style={{display: "flex", gap: 6, padding: "6px 8px"}}>
        <button type="button" disabled={!tab} onClick={() => {void command("back", selected!);}} aria-label="Back">←</button>
        <button type="button" disabled={!tab} onClick={() => {void command("forward", selected!);}} aria-label="Forward">→</button>
        <button type="button" disabled={!tab} onClick={() => {void command("reload", selected!);}} aria-label="Reload">↻</button>
        <input aria-label="Browser address" style={{flex: 1, minWidth: 80}} value={address} onChange={e => setAddress(e.target.value)} placeholder="Search or enter address"/>
        <button type="submit">Go</button>
        <button type="button" onClick={() => setShowHistory(!showHistory)}>History</button>
        {tab && <button type="button" onClick={() => {void command(tab.paused ? "resume" : "pause", selected!);}}>{tab.paused ? "Resume agent" : "Take control"}</button>}
      </form>
      {showHistory && <div style={{maxHeight: 160, overflowY: "auto", padding: 8}}>
        <button onClick={() => {void command("clear_history");}}>Clear history</button>
        {tab && <button onClick={() => {void command("clear_site_data", selected!);}}>Clear this site’s saved data</button>}
        {history.slice().reverse().map(h => <div key={h.url}><button onClick={() => {setShowHistory(false); void command(tab ? "navigate" : "open", selected ?? undefined, h.url);}}>{h.title || h.url}</button></div>)}
      </div>}
      {error && <p role="alert" style={{padding: 8}}>{error}</p>}
      <div style={{height: bodyHeight}}>{tab?.suspended ? <p style={{padding: 24}}>Sleeping tab — loads when needed. <button onClick={() => {void command("focus", tab.sessionId);}}>Load this tab</button></p> : tab ? <BrowserStreamPane key={tab.sessionId} sessionId={tab.sessionId} viewportWidth={1280} viewportHeight={800}/> : <p style={{padding: 24}}>Open a tab and sign in. Your agent shares this browser session.</p>}</div>
    </>}
  </section>;
}
