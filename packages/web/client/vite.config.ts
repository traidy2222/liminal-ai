import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MARKETING_RECORDINGS = path.resolve(__dirname, "../../../assets/marketing/recordings");

/** Serve live capture JSON from assets/marketing/recordings for ?recording= replay. */
function marketingRecordingsPlugin(): Plugin {
  return {
    name: "marketing-recordings",
    configureServer(server) {
      server.middlewares.use("/marketing-recordings", (req, res, next) => {
        const url = (req.url ?? "/").split("?")[0] ?? "/";
        const rel = decodeURIComponent(url.replace(/^\//, ""));
        if (!rel || rel.includes("..")) {
          res.statusCode = 400;
          res.end("bad path");
          return;
        }
        const filePath = path.join(MARKETING_RECORDINGS, rel);
        if (!filePath.startsWith(MARKETING_RECORDINGS)) {
          res.statusCode = 403;
          res.end("forbidden");
          return;
        }
        fs.readFile(filePath, (err, data) => {
          if (err) {
            next();
            return;
          }
          res.setHeader("Content-Type", rel.endsWith(".json") ? "application/json" : "application/octet-stream");
          res.end(data);
        });
      });
    },
  };
}

/** Must match Express `listen(PORT)` in `packages/web/server/index.ts` (default 3001). */
const DEV_API_ORIGIN =
  process.env["VITE_DEV_API_ORIGIN"]?.trim() ||
  `http://127.0.0.1:${process.env["PORT"]?.trim() || "3001"}`;

export default defineConfig({
  plugins: [react(), marketingRecordingsPlugin()],
  // Anchor root + entry inputs to this config's directory so the build resolves
  // correctly regardless of cwd (e.g. `vite build client/` from packages/web,
  // where a relative `root: "."` would otherwise point at packages/web).
  root: __dirname,
  build: {
    outDir: "dist",
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        marketing: path.resolve(__dirname, "marketing.html"),
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      "/api/pty/ws": {
        target: DEV_API_ORIGIN.replace(/^http/, "ws"),
        ws: true,
        changeOrigin: false,
      },
      "/api": {
        target: DEV_API_ORIGIN,
        changeOrigin: false,
        configure: (proxy) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (proxy as any).on("proxyRes", (proxyRes: { headers?: Record<string, string> }, req: { url?: string }) => {
            const url = req.url ?? "";
            if (!url.includes("/api/stream")) return;
            const ct = proxyRes.headers?.["content-type"] ?? "";
            if (!ct.includes("text/event-stream")) return;
            proxyRes.headers = {
              ...proxyRes.headers,
              "cache-control": "no-cache, no-transform",
              "x-accel-buffering": "no",
            };
          });
          // Idle long-lived SSE sockets: avoid default timeouts / early RST where possible.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (proxy as any).on("open", (proxySocket: any) => {
            proxySocket.setTimeout(0);
            try {
              proxySocket.setKeepAlive(true, 60_000);
            } catch {
              /* ignore — rare non-TCP mocks */
            }
          });
          // NOTE: Restarting Express (:3001) while Vite (:3000) is still running resets any
          // open `/api/stream` proxied socket → Vite prints `ECONNRESET`. Expected; reload the
          // page or wait for EventSource reconnect once the API is listening again.
        },
      },
    },
  },
});
