import { Router } from "express";
import type { AgentBridge } from "./agentBridge.js";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision } from "@liminal/core";

export function createRouter(bridge: AgentBridge, sse: SSEManager): Router {
  const router = Router();

  router.get("/api/config", (_req, res) => {
    res.json({
      uiVerbosity: process.env["AGENT_UI_VERBOSITY"]?.trim() === "quiet" ? "quiet" : "normal",
      approvalTimeoutMs: bridge.harness.getApprovalTimeoutMs(),
    });
  });

  router.post("/api/session/reset", (_req, res) => {
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; wait for the current turn to finish." });
      return;
    }
    bridge.clearSession();
    res.json({ ok: true });
  });

  router.get("/api/stream", (req, res) => {
    // Keep SSE sockets alive across longer idle windows.
    req.socket.setKeepAlive(true, 15_000);
    req.socket.setTimeout(0);
    sse.add(req, res);
  });

  router.post("/api/message", async (req, res) => {
    const { message, freshContext } = req.body as { message?: string; freshContext?: boolean };
    if (!message?.trim()) {
      res.status(400).json({ error: "message required" });
      return;
    }
    void bridge.harness.send(message.trim(), { freshContext: Boolean(freshContext) });
    res.json({ ok: true });
  });

  router.post("/api/approve", (req, res) => {
    const { callId, decision } = req.body as {
      callId?: string;
      decision?: ApprovalDecision;
    };
    if (!callId || !decision) {
      res.status(400).json({ error: "callId and decision required" });
      return;
    }
    const resolved = bridge.resolveApproval(callId, decision);
    res.json({ ok: resolved });
  });

  router.post("/api/answer", (req, res) => {
    const { answer } = req.body as { answer?: string };
    if (answer === undefined) {
      res.status(400).json({ error: "answer required" });
      return;
    }
    const resolved = bridge.resolveAskUser(answer);
    res.json({ ok: resolved });
  });

  router.get("/api/status", (_req, res) => {
    res.json({ clients: sse.clientCount });
  });

  return router;
}
