import { Router } from "express";
import type { AgentBridge } from "./agentBridge.js";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision } from "@liminal/core";
import {
  DEFAULT_IMAGE_ATTACHMENT_LIMITS,
  buildMessageWithImageAttachments,
  normalizeImageAttachmentName,
  parseDataUrlImage,
  validateImageAttachments,
  type ImageAttachment,
} from "@liminal/core";
import { persistIncomingAttachments } from "./image_attachment_store.js";

type IncomingAttachment = {
  name?: string;
  dataUrl?: string;
  source?: "clipboard" | "drop" | "path" | "command";
};

export function createRouter(bridge: AgentBridge, sse: SSEManager): Router {
  const router = Router();

  router.get("/api/config", (_req, res) => {
    res.json({
      uiVerbosity: process.env["AGENT_UI_VERBOSITY"]?.trim() === "quiet" ? "quiet" : "normal",
      approvalTimeoutMs: bridge.harness.getApprovalTimeoutMs(),
      personaBootstrapEnabled: process.env["AGENT_PERSONA_BOOTSTRAP"] !== "0",
      personaBootstrapPending: bridge.isAwaitingPersonaBootstrap,
      personaBootstrapAllowSkip: process.env["AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP"] !== "0",
    });
  });

  router.post("/api/session/reset", (_req, res) => {
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; wait for the current turn to finish." });
      return;
    }
    bridge.clearSession();
    res.json({ ok: true });
    void bridge.initializeSessionAfterReset().catch((err) => {
      sse.send("error", {
        message: err instanceof Error ? err.message : "Session greeting failed after reset.",
      });
    });
  });

  router.get("/api/stream", (req, res) => {
    // Keep SSE sockets alive across longer idle windows.
    req.socket.setKeepAlive(true, 15_000);
    req.socket.setTimeout(0);
    sse.add(req, res);
    // If harness is mid-turn, immediately tell the new client so it shows
    // "working..." instead of appearing idle after a reconnect.
    if (bridge.isBusy) {
      res.write(
        `event: harness_running\ndata: ${JSON.stringify({ startedAt: bridge.turnStartTime })}\n\n`
      );
    }
  });

  router.post("/api/message", async (req, res) => {
    if (bridge.isAwaitingPersonaBootstrap) {
      res.status(409).json({ error: "Persona bootstrap is pending. Submit via bootstrap modal." });
      return;
    }
    const { message, freshContext, attachments } = req.body as {
      message?: string;
      freshContext?: boolean;
      attachments?: IncomingAttachment[];
    };
    const msg = String(message ?? "").trim();
    const normalizedAttachments: Array<ImageAttachment & { dataUrl: string }> = [];
    for (const item of attachments ?? []) {
      const dataUrl = String(item?.dataUrl ?? "").trim();
      const parsed = parseDataUrlImage(dataUrl);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      normalizedAttachments.push({
        name: normalizeImageAttachmentName(String(item?.name ?? "image")),
        mimeType: parsed.mimeType,
        dataUrl,
        sizeBytes: parsed.sizeBytes,
        source: item?.source ?? "clipboard",
      });
    }
    const validation = validateImageAttachments(
      normalizedAttachments,
      DEFAULT_IMAGE_ATTACHMENT_LIMITS
    );
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    if (!msg && normalizedAttachments.length === 0) {
      res.status(400).json({ error: "message or attachments required" });
      return;
    }
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is already processing a message" });
      return;
    }
    const persisted = await persistIncomingAttachments(normalizedAttachments);
    const normalizedMessage = buildMessageWithImageAttachments(msg, persisted);
    // Fire-and-forget: respond immediately so the HTTP connection is never held open for a full turn.
    // Agent progress and errors surface exclusively via SSE events — no long-lived POST connection needed.
    res.json({ ok: true });
    bridge.sendUserMessage(normalizedMessage, { freshContext: Boolean(freshContext) }).catch((err) => {
      const message = err instanceof Error ? err.message : "Failed to process message.";
      sse.send("error", { message });
    });
  });

  router.post("/api/persona/bootstrap", async (req, res) => {
    const { input, skip } = req.body as { input?: string; skip?: boolean };
    try {
      await bridge.submitPersonaBootstrap(String(input ?? ""), { skip: Boolean(skip) });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Persona bootstrap failed.";
      const isTimeout = /aborted|timeout|timed out/i.test(message);
      const isConflict =
        /already in progress|still initializing|already processing/i.test(message);
      res.status(isConflict ? 409 : isTimeout ? 504 : 400).json({
        error: isTimeout
          ? "Persona generation timed out. Please retry (or reduce prompt complexity)."
          : message,
        detail: message,
      });
    }
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
    res.json({
      clients: sse.clientCount,
      busy: bridge.isBusy,
      startedAt: bridge.turnStartTime,
    });
  });

  return router;
}
