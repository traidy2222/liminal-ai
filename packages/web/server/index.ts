import { config } from "dotenv";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { loadRuntimePreferences } from "@liminal/core";
import { SSEManager } from "./sse.js";
import { AgentBridge } from "./agentBridge.js";
import { createRouter } from "./routes.js";

// Load `.env` files in order (dotenv does not override existing `process.env` keys by default):
// 1) monorepo root, 2) packages/web, 3) workspace root when it differs — before AgentBridge starts.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "../../../");
const rootEnvPath = join(repoRoot, ".env");
config({ path: rootEnvPath });

const webPkgEnvPath = join(__dirname, "../.env");
if (existsSync(webPkgEnvPath) && resolve(webPkgEnvPath) !== resolve(rootEnvPath)) {
  config({ path: webPkgEnvPath });
}

const targetRoot = resolve(process.env["AGENT_WORKSPACE_ROOT"]?.trim() || repoRoot);
process.env["AGENT_WORKSPACE_ROOT"] = targetRoot;
try {
  process.chdir(targetRoot);
} catch {
  /* ignore */
}

const workspaceEnvPath = join(targetRoot, ".env");
if (
  existsSync(workspaceEnvPath) &&
  resolve(workspaceEnvPath) !== resolve(rootEnvPath) &&
  resolve(workspaceEnvPath) !== resolve(webPkgEnvPath)
) {
  config({ path: workspaceEnvPath });
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

try {
  await bridge.whenToolsRegistered();
} catch (err) {
  console.error(
    "Agent tool registration failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
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
const server = createServer(app);

server.once("error", (err: unknown) => {
  const e = err as NodeJS.ErrnoException;
  if (e?.code === "EADDRINUSE") {
    console.error(
      `Port ${PORT} is already in use. Another Liminal/web server is likely running.\n` +
        `Stop the existing process or set a different PORT, then retry.\n` +
        `Example (PowerShell): $env:PORT=3002; npm run web:dev`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT);

server.once("listening", () => {
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

// Greeting / bootstrap can take a model round — do not block `listen()` on that or
// `web:dev` clients on :5173 see ECONNREFUSED while Vite is already up.
void bridge.whenSessionReady().catch((err) => {
  console.error(
    "Agent session initialization failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});
