/** Isolated demo host: production WsServer + real subprocess harness episodes.
 * Never loads .env or starts the normal installed app/update path. */
import fs from "node:fs/promises";
import path from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url))),
  root = path.resolve(
    process.argv[2] ??
      path.join(
        repo,
        ".agent_artifacts/procedural-memory/native-demo-" + Date.now(),
      ),
  );
await fs.mkdir(root);
const workspace = path.join(root, "repo");
await fs.mkdir(workspace);
Object.assign(process.env, {
  AGENT_GLOBAL_STORAGE_ROOT: path.join(root, "profile"),
  AGENT_WORKSPACE_ROOT: workspace,
  AGENT_WORKSPACE_BOUND: "1",
  AGENT_INTENT_INFERENCE: "0",
  AGENT_WORLD_CONTEXT: "0",
  AGENT_MEMORY_PRIME_ROUND0: "0",
  AGENT_EFFORT_LEARN: "0",
  AGENT_RECIPE_LIBRARY: "0",
  AGENT_TRAJECTORY_WRITE: "0",
  AGENT_AUTO_DREAM: "0",
  AGENT_INBOX_WATCH: "0",
  AGENT_PERSONA_BOOTSTRAP: "0",
  AGENT_SESSION_GREET: "0",
  AGENT_API_KEY: "offline-fixture",
  AGENT_MODEL: "scripted-offline-controller",
  AGENT_API_BASE_URL: "http://127.0.0.1:1",
});
globalThis.fetch = async () => {
  throw new Error("Isolated offline demonstration: network disabled");
};
const convention = {
  schemaVersion: 1,
  family: "json-record",
  name: "Register provider",
  directory: "src/providers",
  filenameParameter: "name",
  fields: {
    name: { parameter: "name" },
    symbol: { parameter: "symbol" },
    kind: { constant: "provider" },
  },
  allowAdditionalFields: false,
};
await fs.writeFile(
  path.join(workspace, "convention.json"),
  JSON.stringify(convention, null, 2),
);
const { WsServer } = await import("../packages/sidecar/dist/ws_server.js");
const token = randomUUID();
const server = new WsServer({
  token,
  repoRoot: workspace,
  provider: {
    apiKey: "offline-fixture",
    model: "scripted-offline-controller",
    baseURL: "http://127.0.0.1:1",
    keySource: "AGENT_API_KEY",
  },
  runtimePreferences: null,
});
const bridge = await server.registry.create({
  workspaceRoot: workspace,
  title: "Procedural memory demonstration",
});
bridge.harness.config.proceduralMemory = {
  enabled: true,
  databasePath: path.join(root, "profile/procedures.sqlite"),
};
const port = await server.listen();
let index = 0,
  busy = false;
const phases = ["acquire", "reuse", "unrelated", "drift", "repair"];
const demo = createServer(async (req, res) => {
  if (req.headers.authorization !== `Bearer ${token}`) {
    res.writeHead(401);
    res.end();
    return;
  }
  if (req.url !== "/advance" || req.method !== "POST") {
    res.writeHead(404);
    res.end();
    return;
  }
  if (busy || index >= phases.length) {
    res.writeHead(409);
    res.end("No next phase or phase running");
    return;
  }
  busy = true;
  const phase = phases[index];
  try {
    const child = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        path.join(repo, "packages/eval/src/procedural/demo_worker.ts"),
        root,
        phase,
      ],
      { cwd: repo, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let log = "";
    child.stdout.on("data", (b) => (log += b));
    child.stderr.on("data", (b) => (log += b));
    const timer = setTimeout(() => child.kill(), 90000);
    const code = await new Promise((resolve) => child.once("exit", resolve));
    clearTimeout(timer);
    await fs.writeFile(path.join(root, phase + ".process.log"), log);
    if (code !== 0)
      throw new Error(`Phase ${phase} failed; inspect process log`);
    const report = JSON.parse(
      await fs.readFile(path.join(root, phase + ".result.json"), "utf8"),
    );
    index++;
    // Relay actual bounded activities from the source worker, preserving run/version IDs.
    for (const activity of report.activities)
      bridge.harness.emitter.emit("procedure_activity", activity);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        phase,
        pid: report.pid,
        complete: index === phases.length,
        next: phases[index] ?? null,
        report,
      }),
    );
  } catch (error) {
    res.writeHead(500);
    res.end(String(error));
  } finally {
    busy = false;
  }
});
await new Promise((resolve) => demo.listen(0, "127.0.0.1", resolve));
const config = {
  port,
  demoPort: demo.address().port,
  token,
  chatId: bridge.chatId,
  root,
};
await fs.writeFile(
  path.join(root, "preview-config.json"),
  JSON.stringify(config, null, 2),
);
console.log(
  JSON.stringify({ root, configPath: path.join(root, "preview-config.json") }),
);
const stop = () => {
  server.close();
  demo.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
