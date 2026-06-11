import React, { useCallback, useEffect, useRef, useState } from "react";
import { useChats } from "../chat/useChats.js";
import { webApiStreamUrl } from "../webApiAuth.js";
import { PanelResizeHandle } from "../terminal/PanelResizeHandle.js";

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
          const meta = JSON.parse(ev.data) as { type?: string; url?: string };
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
      const pt = mapToViewport(ev.clientX, ev.clientY, rect, viewportWidth, viewportHeight);
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
      const pt = mapToViewport(ev.clientX, ev.clientY, rect, viewportWidth, viewportHeight);
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
      }}
      onPointerDown={onPointer}
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

/** Collapsible live browser panel (CDP screencast + click/scroll relay). */
export function BrowserDock() {
  const { state } = useChats();
  const chatId = state.activeChatId;
  const [open, setOpen] = useState(false);
  const [bodyHeight, setBodyHeight] = useState(defaultBrowserHeight);
  const [view, setView] = useState<BrowserViewWire | null>(null);

  useEffect(() => {
    setView(null);
    setOpen(false);
  }, [chatId]);

  useEffect(() => {
    const onView = (ev: Event) => {
      const detail = (ev as CustomEvent<BrowserViewWire>).detail;
      if (!detail) return;
      if (detail.chatId && detail.chatId !== chatId) return;
      if (!detail.open) {
        setView(null);
        setOpen(false);
        return;
      }
      setView(detail);
      setOpen(true);
    };
    window.addEventListener("liminal:browser_view", onView);
    return () => window.removeEventListener("liminal:browser_view", onView);
  }, [chatId]);

  const onResizeHeight = useCallback((delta: number) => {
    const { min, max } = browserHeightBounds();
    setBodyHeight((h) => Math.min(max, Math.max(min, h + delta)));
  }, []);

  if (!view?.open) return null;

  const useNativeEmbed = view.embedMode !== "screencast";
  const embedUrl = view.url?.trim() ?? "";
  const vw = view.viewportWidth ?? 1280;
  const vh = view.viewportHeight ?? 800;

  return (
    <div
      style={{
        flexShrink: 0,
        borderTop: "1px solid rgba(255,255,255,0.08)",
        background: "rgba(8,12,18,0.96)",
        display: "flex",
        flexDirection: "column",
        maxHeight: open ? bodyHeight + 40 : 0,
      }}
    >
      <PanelResizeHandle axis="vertical" onDragDelta={onResizeHeight} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "6px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#9fd4ff" }}>Browser</span>
        <span
          style={{
            flex: 1,
            fontSize: 12,
            color: "#8aa0b5",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={view.url}
        >
          {view.title?.trim() || view.url || "Agent browser"}
        </span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          style={{
            background: "transparent",
            border: "none",
            color: "#8aa0b5",
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          {open ? "Hide" : "Show"}
        </button>
      </div>
      {open && (
        <div style={{ height: bodyHeight, display: "flex", flexDirection: "column" }}>
          {useNativeEmbed && embedUrl.startsWith("http") ? (
            <iframe
              title="Agent browser"
              src={embedUrl}
              style={{ flex: 1, width: "100%", border: "none", background: "#0a0f14" }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
            />
          ) : (
            <BrowserStreamPane sessionId={view.sessionId} viewportWidth={vw} viewportHeight={vh} />
          )}
          <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "#6d8296" }}>
            {useNativeEmbed
              ? "Native page embed — interact directly in the panel."
              : "Click or scroll to interact — agent retains control between your actions."}
          </div>
        </div>
      )}
    </div>
  );
}
