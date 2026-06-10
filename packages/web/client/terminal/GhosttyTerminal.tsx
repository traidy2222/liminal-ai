import React, { useEffect, useRef, useState } from "react";
import { ensureWebAuthReady, webApiFetch, webApiStreamUrl } from "../webApiAuth.js";
import { installTerminalFit, waitForTerminalHost } from "./terminalFit.js";

export interface GhosttyTerminalProps {
  chatId: string;
  /** When set, attach to an existing PTY (agent-opened) instead of opening a new one. */
  sessionId?: string;
  active: boolean;
  /** Fixed body height in pixels (from drag resize). */
  bodyHeightPx?: number;
  minHeight?: number;
  /** When false, unmount does not close the server session (multi-tab dock). */
  closeOnUnmount?: boolean;
}

/**
 * Per-chat interactive shell (Ghostty VT in the browser) backed by `node-pty` on the web server.
 */
export function GhosttyTerminal({
  chatId,
  sessionId: initialSessionId,
  active,
  bodyHeightPx,
  minHeight = 160,
  closeOnUnmount = true,
}: GhosttyTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<import("ghostty-web").Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<string | null>(initialSessionId ?? null);
  const [error, setError] = useState<string | null>(null);
  const [cwd, setCwd] = useState<string | null>(null);

  useEffect(() => {
    if (!active || !chatId) return;
    let disposed = false;

    const run = async () => {
      setError(null);
      await ensureWebAuthReady();
      const { init, Terminal, FitAddon } = await import("ghostty-web");
      await init();
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        cursorBlink: true,
        theme: {
          background: "#0a0f14",
          foreground: "#e6edf3",
          cursor: "#9ad1c0",
        },
      });
      term.open(hostRef.current);
      termRef.current = term;

      let fitHandle: ReturnType<typeof installTerminalFit> | undefined;
      const syncPtyResize = (cols: number, rows: number) => {
        const sid = sessionRef.current;
        if (!sid) return;
        void webApiFetch("/api/pty/resize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid, cols, rows }),
        });
      };

      await waitForTerminalHost(hostRef.current);
      fitHandle = installTerminalFit(term, FitAddon, syncPtyResize);
      const initial = fitHandle.fit();

      let sessionId = initialSessionId?.trim() ?? "";
      if (!sessionId) {
        const openRes = await webApiFetch("/api/pty/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chatId,
            cols: initial?.cols ?? term.cols,
            rows: initial?.rows ?? term.rows,
            source: "user",
          }),
        });
        const body = (await openRes.json()) as {
          error?: string;
          sessionId?: string;
          cwd?: string;
        };
        if (!openRes.ok) {
          throw new Error(body.error ?? `PTY open failed (${openRes.status})`);
        }
        sessionId = body.sessionId ?? "";
        setCwd(body.cwd ?? null);
      }

      sessionRef.current = sessionId;
      if (initial) syncPtyResize(initial.cols, initial.rows);

      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const wsUrl = webApiStreamUrl(
        `${wsProto}//${window.location.host}/api/pty/ws?sessionId=${encodeURIComponent(sessionId)}`
      );

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onmessage = (ev) => {
        const chunk =
          typeof ev.data === "string"
            ? ev.data
            : ev.data instanceof Blob
              ? null
              : String(ev.data);
        if (chunk) term.write(chunk);
        else if (ev.data instanceof Blob) {
          void ev.data.text().then((text) => {
            if (text) term.write(text);
          });
        }
      };
      ws.onerror = () => {
        if (!disposed) setError("Terminal connection error");
      };
      ws.onclose = () => {
        if (!disposed) term.write("\r\n\x1b[33m[session closed]\x1b[0m\r\n");
      };

      term.onData((data) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(data);
      });

      return () => {
        fitHandle?.dispose();
      };
    };

    let cleanup: (() => void) | undefined;
    void run()
      .then((c) => {
        cleanup = c;
      })
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      disposed = true;
      cleanup?.();
      wsRef.current?.close();
      wsRef.current = null;
      const sid = sessionRef.current;
      sessionRef.current = null;
      if (closeOnUnmount && sid) {
        void webApiFetch("/api/pty/close", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        });
      }
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, [chatId, active, initialSessionId, closeOnUnmount]);

  const panelHeight =
    bodyHeightPx ??
    (typeof window !== "undefined"
      ? Math.round(Math.min(Math.max(window.innerHeight * 0.28, minHeight), 520))
      : 280);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: panelHeight,
        minHeight,
        flexShrink: 0,
      }}
    >
      {error ? (
        <div style={{ padding: 8, color: "var(--lim-danger, #ff2244)", fontSize: 12 }}>{error}</div>
      ) : null}
      <div ref={hostRef} style={{ flex: 1, minHeight: 0, width: "100%", background: "#0a0f14" }} />
    </div>
  );
}
