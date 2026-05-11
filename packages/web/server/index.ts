import { config } from "dotenv";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import { loadRuntimePreferences } from "@liminal/core";
import { SSEManager } from "./sse.js";
import { AgentBridge } from "./agentBridge.js";
import { createRouter } from "./routes.js";

// Load .env from monorepo root before AgentBridge reads provider env config
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../../../.env") });

const repoRoot = join(__dirname, "../../../");
const targetRoot = resolve(process.env["AGENT_WORKSPACE_ROOT"]?.trim() || repoRoot);
process.env["AGENT_WORKSPACE_ROOT"] = targetRoot;
// Default to balanced gate so plan() satisfies the destructive pre-flight (not just think()).
// Can still be overridden by setting AGENT_DESTRUCTIVE_GATE=strict in .env.
if (!process.env["AGENT_DESTRUCTIVE_GATE"]) {
  process.env["AGENT_DESTRUCTIVE_GATE"] = "balanced";
}
try {
  process.chdir(targetRoot);
} catch {
  /* ignore */
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const sse = new SSEManager();
const runtimePreferences = await loadRuntimePreferences(targetRoot);
const bridge = new AgentBridge(sse, runtimePreferences);
const router = createRouter(bridge, sse);
app.use(router);

const webPkgRoot = join(__dirname, "..");
const clientDist = join(webPkgRoot, "client/dist");
const clientIndexHtml = join(clientDist, "index.html");

function tryBuildWebClient(): void {
  if (process.env["AGENT_WEB_SKIP_CLIENT_BUILD"] === "1") return;
  console.log("Web UI dist not found; running `vite build client/` …");
  execSync("npx vite build client/", {
    cwd: webPkgRoot,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "/bin/sh",
  });
}

if (!existsSync(clientIndexHtml)) {
  try {
    tryBuildWebClient();
  } catch {
    console.error(
      "Could not build web client (is `vite` installed? try `npm install` in repo root).\n" +
        "Build manually: npm run build:client --workspace=packages/web\n" +
        "Dev with hot reload: npm run web:dev"
    );
    throw new Error("Liminal web: missing client/dist after build attempt");
  }
}

if (existsSync(clientIndexHtml)) {
  app.use(express.static(clientDist));
} else {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .type("text/plain")
      .send(
        "Liminal web API is running, but the web UI is not built here.\n" +
          "From repo root:\n" +
          "  npm run web              — build client + serve API + static UI on PORT (default :3001)\n" +
          "  npm run web:dev          — Express API on :3001 + Vite dev server on :5173 (hot reload)\n" +
          "  npm run build:client --workspace=packages/web   — build only, then use npm run start in packages/web\n" +
          "To run API without a UI build: set AGENT_WEB_SKIP_CLIENT_BUILD=1"
      );
  });
}

const PORT = Number(process.env["PORT"] ?? 3001);
const server = app.listen(PORT, () => {
  console.log(`Liminal web server → http://localhost:${PORT}`);
  console.log(`SSE stream         → http://localhost:${PORT}/api/stream`);
  const anyKeySet = Boolean(
    process.env["AGENT_API_KEY"] ||
      process.env["OPENROUTER_API_KEY"] ||
      process.env["OPENAI_API_KEY"] ||
      process.env["ANTHROPIC_API_KEY"] ||
      process.env["XAI_API_KEY"]
  );
  console.log(`API key:           ${anyKeySet ? "set" : "MISSING"}`);
});

// SSE-friendly server tuning: avoid idle keepalive/header timeouts closing streams.
server.keepAliveTimeout = 75_000;
server.headersTimeout = 90_000;
server.requestTimeout = 0;
