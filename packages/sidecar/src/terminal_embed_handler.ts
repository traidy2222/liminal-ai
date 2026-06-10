import { createReadStream, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PtyManager } from "./pty_manager.js";

function resolveVendorDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.join(here, "terminal-vendor"),
    path.join(here, "..", "dist", "terminal-vendor"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "ghostty-web.umd.cjs"))) return dir;
  }
  return candidates[0]!;
}

const VENDOR_FILES: Record<string, { file: string; contentType: string }> = {
  "/terminal/ghostty-web.umd.cjs": {
    file: "ghostty-web.umd.cjs",
    contentType: "application/javascript; charset=utf-8",
  },
  "/terminal/ghostty-web.js": {
    file: "ghostty-web.js",
    contentType: "application/javascript; charset=utf-8",
  },
  "/terminal/__vite-browser-external-2447137e.js": {
    file: "__vite-browser-external-2447137e.js",
    contentType: "application/javascript; charset=utf-8",
  },
  "/terminal/ghostty-vt.wasm": {
    file: "ghostty-vt.wasm",
    contentType: "application/wasm",
  },
};

/** Serve vendored ghostty-web assets (loopback-only; no token — sub-imports omit query params). */
export function tryHandleTerminalAssetRequest(
  req: IncomingMessage,
  res: ServerResponse,
  _opts: { token: string }
): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const spec = VENDOR_FILES[url.pathname];
  if (!spec) return false;

  const filePath = path.join(resolveVendorDir(), spec.file);
  if (!existsSync(filePath)) {
    res.writeHead(503, { "Content-Type": "text/plain" });
    res.end("terminal vendor assets missing (rebuild sidecar)");
    return true;
  }

  res.writeHead(200, {
    "Content-Type": spec.contentType,
    "Cache-Control": "no-cache",
  });
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  createReadStream(filePath).pipe(res);
  return true;
}

/** Resize PTY from the desktop embed (after local Ghostty fit). */
export function tryHandleTerminalResizeRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { token: string; ptyManager: PtyManager }
): boolean {
  if (req.method !== "POST") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/pty/resize") return false;
  const token = url.searchParams.get("token")?.trim();
  if (!token || token !== opts.token) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("unauthorized");
    return true;
  }

  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(Buffer.from(c)));
  req.on("end", () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
        sessionId?: string;
        cols?: number;
        rows?: number;
      };
      const sessionId = String(body.sessionId ?? "").trim();
      const cols = Number(body.cols);
      const rows = Number(body.rows);
      if (!sessionId || !Number.isFinite(cols) || !Number.isFinite(rows)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: "sessionId, cols, rows required" }));
        return;
      }
      const ok = opts.ptyManager.resize(sessionId, cols, rows);
      res.writeHead(ok ? 200 : 404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid json" }));
    }
  });
  return true;
}

/** Minimal Ghostty-web embed for desktop WebView (session opened via `pty_open`). */
export function tryHandleTerminalEmbedRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: { token: string }
): boolean {
  if (req.method !== "GET") return false;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/terminal/embed") return false;

  const token = url.searchParams.get("token")?.trim();
  const sessionId = url.searchParams.get("sessionId")?.trim();
  if (!token || token !== opts.token || !sessionId) {
    res.writeHead(401, { "Content-Type": "text/plain" });
    res.end("unauthorized");
    return true;
  }

  const port = url.searchParams.get("port") ?? "";
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Liminal Terminal</title>
  <style>
    html, body { margin: 0; height: 100%; background: #0a0f14; overflow: hidden; }
    #host { height: 100%; width: 100%; }
    #status {
      position: fixed; left: 8px; bottom: 6px; font: 10px ui-monospace, monospace;
      color: #556677; pointer-events: none; z-index: 2;
    }
    #err {
      position: fixed; inset: 0; display: none; place-items: center;
      padding: 16px; color: #ff8899; font: 12px ui-monospace, monospace;
      background: rgba(0,0,0,0.85); white-space: pre-wrap; text-align: center;
    }
  </style>
  <script src="/terminal/ghostty-web.umd.cjs"></script>
</head>
<body>
  <div id="host"></div>
  <div id="status">loading…</div>
  <div id="err"></div>
  <script>
    (async function () {
      const sessionId = ${JSON.stringify(sessionId)};
      const token = ${JSON.stringify(token)};
      const port = ${JSON.stringify(port)};
      const status = document.getElementById("status");
      const errEl = document.getElementById("err");
      const showErr = function (msg) {
        errEl.style.display = "grid";
        errEl.textContent = msg;
        status.textContent = "error";
      };
      try {
        if (!window.GhosttyWeb) throw new Error("GhosttyWeb bundle failed to load");
        const init = window.GhosttyWeb.init;
        const Terminal = window.GhosttyWeb.Terminal;
        await init();
        status.textContent = "connecting…";
        const term = new Terminal({
          fontSize: 13,
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          cursorBlink: true,
          theme: { background: "#0a0f14", foreground: "#e6edf3", cursor: "#9ad1c0" },
        });
        const hostEl = document.getElementById("host");
        term.open(hostEl);
        const FitAddon = window.GhosttyWeb.FitAddon;
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        let lastCols = 0;
        let lastRows = 0;
        let fitTimer = null;
        let ws = null;
        const syncPty = function (cols, rows) {
          fetch(
            "http://127.0.0.1:" + port + "/pty/resize?token=" + encodeURIComponent(token),
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ sessionId, cols, rows }),
            }
          ).catch(function () {});
        };
        const applyFit = function () {
          const dims = fitAddon.proposeDimensions();
          if (!dims) return false;
          if (dims.cols === lastCols && dims.rows === lastRows) return true;
          lastCols = dims.cols;
          lastRows = dims.rows;
          fitAddon.fit();
          syncPty(dims.cols, dims.rows);
          return true;
        };
        const scheduleFit = function () {
          if (fitTimer) clearTimeout(fitTimer);
          fitTimer = setTimeout(applyFit, 80);
        };
        window.__liminalTerminalFit = scheduleFit;
        fitAddon.observeResize();
        window.addEventListener("resize", scheduleFit);
        await new Promise(function (resolve) {
          const wait = function () {
            if (hostEl && hostEl.clientWidth >= 40 && hostEl.clientHeight >= 40 && applyFit()) {
              resolve();
            } else {
              setTimeout(wait, 40);
            }
          };
          wait();
        });
        status.textContent = "connecting…";
        ws = new WebSocket(
          "ws://127.0.0.1:" + port + "/pty?token=" + encodeURIComponent(token) +
          "&sessionId=" + encodeURIComponent(sessionId)
        );
        ws.onopen = function () { status.textContent = "connected"; };
        ws.onerror = function () { showErr("WebSocket connection failed"); };
        ws.onclose = function () {
          status.textContent = "closed";
          term.write("\\r\\n\\x1b[33m[session closed]\\x1b[0m\\r\\n");
        };
        ws.onmessage = function (e) {
          const data = typeof e.data === "string" ? e.data : "";
          if (data) term.write(data);
        };
        term.onData(function (d) {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(d);
        });
      } catch (err) {
        showErr(err && err.message ? err.message : String(err));
      }
    })();
  </script>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
  return true;
}
