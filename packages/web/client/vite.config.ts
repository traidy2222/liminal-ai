import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
        target: "http://localhost:3001",
        changeOrigin: false,
        configure: (proxy) => {
          // Disable socket timeout for SSE — the default http-proxy timeout
          // resets long-lived /api/stream connections with ERR_CONNECTION_RESET.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (proxy as any).on("open", (proxySocket: any) => {
            proxySocket.setTimeout(0);
          });
        },
      },
    },
  },
});
