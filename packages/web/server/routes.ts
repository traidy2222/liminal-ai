import { Router } from "express";
import type { AgentBridge } from "./agentBridge.js";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision } from "@liminal/core";

export function createRouter(bridge: AgentBridge, sse: SSEManager): Router {
  const router = Router();

  router.get("/api/stream", (req, res) => {
    sse.add(res);
  });

  router.post("/api/message", async (req, res) => {
    const { message } = req.body as { message?: string };
    if (!message?.trim()) {
      res.status(400).json({ error: "message required" });
      return;
    }
    void bridge.harness.send(message.trim());
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
