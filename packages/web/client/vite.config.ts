import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Must match Express `listen(PORT)` in `packages/web/server/index.ts` (default 3001). */
const DEV_API_ORIGIN =
  process.env["VITE_DEV_API_ORIGIN"]?.trim() ||
  `http://127.0.0.1:${process.env["PORT"]?.trim() || "3001"}`;

export default defineConfig({
  plugins: [react()],
  root: ".",
  build: {
    outDir: "dist",
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: DEV_API_ORIGIN,
        changeOrigin: false,
        configure: (proxy) => {
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
