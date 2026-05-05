import { config } from "dotenv";
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
try {
  process.chdir(targetRoot);
} catch {
  /* ignore */
}

const app = express();
app.use(cors());
app.use(express.json());

const sse = new SSEManager();
const runtimePreferences = await loadRuntimePreferences();
const bridge = new AgentBridge(sse, runtimePreferences);
const router = createRouter(bridge, sse);
app.use(router);

// Serve built client if available (run: npm run build:client in packages/web first)
const clientDist = join(__dirname, "../client/dist");
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
}

const PORT = Number(process.env["PORT"] ?? 3001);
app.listen(PORT, () => {
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
