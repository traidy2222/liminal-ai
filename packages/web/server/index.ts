import { config } from "dotenv";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import { SSEManager } from "./sse.js";
import { ChatManager } from "./chatManager.js";
import { createRouter } from "./routes.js";
import {
  allowedWebCorsOrigins,
  createLocalWebAuth,
  resolveWebBindHost,
} from "./local_auth.js";
import { injectWebAuthIntoHtml } from "./serve_client_html.js";
import { readChatMetadata } from "@liminal/core";
import { attachWebPtyUpgrade, createWebPtyContext, registerPtyRoutes } from "./pty_http.js";
import {
  attachBrowserStreamUpgrade,
  createWebBrowserContext,
  registerBrowserRoutes,
} from "./browser_http.js";
import { createWebEnsureTerminal } from "./pty_terminal.js";
import {
  setPtyShellPort,
  setTerminalEnsureHandler,
  setTerminalViewPublisher,
} from "@liminal/tools";
import { createWebPtyShellPort } from "./pty_shell_port.js";

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

const PORT = Number(process.env["PORT"] ?? 3001);
const localAuth = await createLocalWebAuth();
const corsOrigins = allowedWebCorsOrigins(PORT);

const app = express();
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  })
);
// Chrome Private Network Access — public site (vireondynamics.com) → loopback handoff.
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Private-Network", "true");
  next();
});
app.use(express.urlencoded({ extended: false, limit: "20mb" }));
app.use(express.json({ limit: "20mb" }));

const sse = new SSEManager();
// Multi-chat manager owns every AgentBridge in process. boot() loads chats
// from ~/.liminal/chats/, picks the most-recently-updated as active (or
// creates a default scratch chat), and lazy-constructs subsequent bridges
// on activate. Runtime prefs are loaded inside boot() from the user-global
// path (Phase 1 storage split).
const browserCtx = createWebBrowserContext(localAuth.token);
const ptyCtx = createWebPtyContext(localAuth.token, async (chatId) => {
  const meta = await readChatMetadata(chatId);
  if (!meta) throw new Error(`Unknown chat ${chatId}`);
  return meta.workspaceRoot;
});
setTerminalEnsureHandler(createWebEnsureTerminal(ptyCtx));
setPtyShellPort(createWebPtyShellPort(ptyCtx));
setTerminalViewPublisher((payload) => {
  sse.send("terminal_view", payload, payload.chatId);
});
const chatManager = new ChatManager(sse);
const bootedChat = await chatManager.boot();
console.log(
  `Liminal chat manager → active chat ${bootedChat.activeChatId} (${bootedChat.activeMeta.workspaceMode} @ ${bootedChat.activeMeta.workspaceRoot})`
);
app.use((req, res, next) => {
  if (!req.path.startsWith("/api")) {
    next();
    return;
  }
  localAuth.requireAuth(req, res, next);
});

const router = createRouter(chatManager, sse, localAuth);
registerPtyRoutes(router, ptyCtx, (req, res, next) => {
  localAuth.requireAuth(req, res, next);
});
registerBrowserRoutes(router, browserCtx, (req, res, next) => {
  localAuth.requireAuth(req, res, next);
});
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
  await chatManager.getActive().whenToolsRegistered();
} catch (err) {
  console.error(
    "Agent tool registration failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
}

if (effectiveHarnessEnvRaw("AGENT_BROWSER") === "1") {
  void (async () => {
    try {
      const pw = await import("playwright");
      const exe = pw.chromium.executablePath();
      if (!existsSync(exe)) {
        console.warn(
          "AGENT_BROWSER=1 but Chromium is not installed. Run: npm run browser:install"
        );
      }
    } catch {
      console.warn(
        "AGENT_BROWSER=1 but playwright is unavailable. Install: npm run browser:install"
      );
    }
  })();
}

if (existsSync(clientIndexHtml)) {
  app.get(["/", "/index.html"], async (_req, res, next) => {
    try {
      const raw = await readFile(clientIndexHtml, "utf8");
      res.type("html").send(injectWebAuthIntoHtml(raw, localAuth.token));
    } catch (err) {
      next(err);
    }
  });
  app.use(express.static(clientDist, { index: false }));
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

const bindHost = resolveWebBindHost();
const server = createServer(app);
attachWebPtyUpgrade(server, ptyCtx);
attachBrowserStreamUpgrade(server, browserCtx);

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

server.listen(PORT, bindHost);

server.once("listening", () => {
  console.log(`Liminal web server → http://${bindHost}:${PORT}`);
  console.log(`SSE stream         → http://${bindHost}:${PORT}/api/stream`);
  if (bindHost !== "127.0.0.1" && bindHost !== "::1" && bindHost !== "localhost") {
    console.warn(
      `[security] Web server bound to ${bindHost} — exposes unauthenticated agent control if AGENT_WEB_TOKEN is not set. Prefer 127.0.0.1.`
    );
  }
  console.log(`Web auth token     → ${process.env["AGENT_WEB_TOKEN"] ? "AGENT_WEB_TOKEN (env)" : "~/.liminal/web_token"}`);
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
void chatManager.getActive().whenSessionReady().catch((err) => {
  console.error(
    "Agent session initialization failed:",
    err instanceof Error ? err.message : String(err)
  );
  process.exit(1);
});

// Clean shutdown — dispose every resident bridge on SIGTERM/SIGINT so file
// descriptors (session log streams, write_staging stream sinks) close cleanly.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    try {
      chatManager.shutdown();
      ptyCtx.ptyManager.disposeAll();
    } finally {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 2000).unref();
    }
  });
}
