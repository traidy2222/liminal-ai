/** Production WebSocket round-trip, isolated profile, no desktop automation. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
const root = path.resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("Pass an existing demo output directory");
await fs.access(path.join(root, "demo-results.json"));
const workspace = path.join(root, "repo");
Object.assign(process.env, {
  AGENT_GLOBAL_STORAGE_ROOT: path.join(root, "sidecar-probe-" + randomUUID()),
  AGENT_WORKSPACE_ROOT: workspace,
  AGENT_WORKSPACE_BOUND: "1",
  AGENT_INBOX_WATCH: "0",
  AGENT_INTENT_INFERENCE: "0",
  AGENT_WORLD_CONTEXT: "0",
  AGENT_PERSONA_BOOTSTRAP: "0",
  AGENT_SESSION_GREET: "0",
  AGENT_API_KEY: "offline-fixture",
  AGENT_MODEL: "offline-fixture",
  AGENT_API_BASE_URL: "http://127.0.0.1:1",
});
globalThis.fetch = async () => {
  throw new Error("Offline protocol check: network disabled");
};
const { WsServer } = await import("../packages/sidecar/dist/ws_server.js");
const token = randomUUID(),
  server = new WsServer({
    token,
    repoRoot: workspace,
    runtimePreferences: null,
    provider: {
      apiKey: "offline-fixture",
      baseURL: "http://127.0.0.1:1",
      model: "offline-fixture",
      keySource: "AGENT_API_KEY",
    },
  });
let socket;
try {
  const bridge = await server.registry.create({
    workspaceRoot: workspace,
    title: "Procedure protocol probe",
  });
  bridge.harness.config.proceduralMemory = {
    enabled: true,
    databasePath: path.join(root, "profile/procedures.sqlite"),
  };
  const port = await server.listen();
  const unauthorized = new WebSocket(`ws://127.0.0.1:${port}?token=incorrect`);
  unauthorized.on("error", () => {});
  await new Promise((resolve, reject) => {
    unauthorized.once("unexpected-response", (_request, response) => {
      try {
        assert.equal(response.statusCode, 401);
        response.destroy();
        resolve();
      } catch (e) {
        reject(e);
      }
    });
    unauthorized.once("open", () =>
      reject(new Error("Unauthorized socket was admitted")),
    );
  });
  socket = new WebSocket(`ws://127.0.0.1:${port}?token=${token}`);
  const pending = new Map();
  socket.on("message", (bytes) => {
    const frame = JSON.parse(String(bytes));
    if (frame.event === "command_result")
      pending.get(frame.data.commandId)?.(frame.data);
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  const command = (action, payload = {}) =>
    new Promise((resolve, reject) => {
      const id = randomUUID(),
        timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Protocol command timeout"));
        }, 10000);
      pending.set(id, (result) => {
        clearTimeout(timer);
        pending.delete(id);
        if (!result.ok) reject(new Error(result.error));
        else resolve(result.data);
      });
      socket.send(
        JSON.stringify({
          v: 1,
          t: "cmd",
          id,
          command: "procedure_manage",
          data: { chatId: bridge.chatId, action, ...payload },
        }),
      );
    });
  const list = await command("list");
  assert(list.procedures.length >= 3);
  const old = list.procedures.find(
    (p) => p.body.name === "Register provider" && p.body.version === 1,
  );
  const detail = await command("inspect", { versionId: old.body.versionId });
  assert(detail.history.length >= 3);
  const failed = detail.events.find(
    (e) => e.kind === "verification" && e.ok === false,
  );
  assert(failed);
  const evidence = await command("evidence", {
    eventId: failed.eventId,
    offset: 0,
  });
  assert(JSON.parse(evidence.content).correct === false);
  console.log(
    JSON.stringify({
      unauthorizedRefused: true,
      ownerList: true,
      immutableHistory: true,
      failedEvidenceRoundTrip: true,
      procedures: list.procedures.length,
    }),
  );
} finally {
  socket?.terminate();
  server.close();
}
