import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import { SSEManager } from "./sse.js";
import { AgentBridge } from "./agentBridge.js";
import { createRouter } from "./routes.js";

// Load .env from monorepo root before AgentBridge reads OPENROUTER_API_KEY
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "../../../.env") });

const app = express();
app.use(cors());
app.use(express.json());

const sse = new SSEManager();
const bridge = new AgentBridge(sse);
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
  console.log(`API key:           ${process.env["OPENROUTER_API_KEY"] ? "set" : "MISSING"}`);
});
