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
  buildHarnessSettingsApiFields,
  HARNESS_SETTINGS_TABS,
  HARNESS_MANAGED_ENV_KEY_SET,
  harnessEnvResolutionMeta,
  resolveHarnessEnvRaw,
  resolvePersonalityHeartbeatConfig,
} from "@liminal/core";
import { loadPersonaUiThemeFromWorkspace } from "@liminal/tools";
import { persistIncomingAttachments } from "./image_attachment_store.js";

type IncomingAttachment = {
  name?: string;
  dataUrl?: string;
  source?: "clipboard" | "drop" | "path" | "command";
};

export function createRouter(bridge: AgentBridge, sse: SSEManager): Router {
  const router = Router();

  router.get("/api/config", async (_req, res) => {
    try {
      // `listen()` does not await this; avoid stale `personaBootstrapPending` and races with bootstrap.
      await bridge.whenSessionReady();
      const prefs = bridge.harness.getRuntimePreferences();
      const uiRaw = resolveHarnessEnvRaw("AGENT_UI_VERBOSITY", prefs)?.trim();
      let personaUiTheme: import("@liminal/core").PersonaUiThemeV2 | null = null;
      try {
        personaUiTheme = await loadPersonaUiThemeFromWorkspace();
      } catch {
        personaUiTheme = null;
      }
      const persona = bridge.harness.getCurrentPersona();
      const personaDisplayLabel =
        personaUiTheme?.displayLabel?.trim() ||
        persona?.name?.trim() ||
        "LIMINAL";
      const ph = resolvePersonalityHeartbeatConfig(prefs);
      res.json({
        uiVerbosity: uiRaw === "quiet" ? "quiet" : "normal",
        approvalTimeoutMs: bridge.harness.getApprovalTimeoutMs(),
        personaBootstrapEnabled: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", prefs) !== "0",
        personaBootstrapPending: bridge.isAwaitingPersonaBootstrap,
        personaBootstrapAllowSkip: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP", prefs) !== "0",
        personaUiTheme,
        personaDisplayLabel,
        personalityHeartbeatEnabled: ph.enabled,
        personalityHeartbeatUiStrip: ph.uiStripDefault,
      });
    } catch (err) {
      console.error("/api/config failed:", err instanceof Error ? err.stack ?? err.message : String(err));
      res.status(200).json({
        uiVerbosity: "normal",
        approvalTimeoutMs: 120_000,
        personaBootstrapEnabled: true,
        personaBootstrapPending: false,
        personaBootstrapAllowSkip: true,
        personaUiTheme: null,
        personaDisplayLabel: "LIMINAL",
        personalityHeartbeatEnabled: false,
        personalityHeartbeatUiStrip: false,
        configDegraded: true,
        configError: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/api/settings", (_req, res) => {
    const prefs = bridge.harness.getRuntimePreferences();
    const fields = buildHarnessSettingsApiFields(prefs);
    const cfg = bridge.harness.config;
    const envModel = process.env["AGENT_MODEL"]?.trim();
    const envBase = process.env["AGENT_API_BASE_URL"]?.trim();
    const apiKeyConfigured = !!(cfg.openRouterApiKey && cfg.openRouterApiKey.trim().length > 0);
    res.json({
      tabs: HARNESS_SETTINGS_TABS,
      fields,
      /** Matches the live OpenAI client: prefs + env + defaults (see `resolveProviderConfig`). */
      provider: {
        model: (cfg.model ?? "").slice(0, 200),
        baseURL: (cfg.baseURL ?? "").slice(0, 500),
        modelLockedByEnv: !!envModel,
        baseURLLockedByEnv: !!envBase,
        apiKeyConfigured,
      },
      hint:
        "API keys are never shown here — only whether one loaded. Set `AGENT_API_KEY` or `OPENROUTER_API_KEY` (etc.) in `.env`. Model/base URL reflect the running harness (saved prefs, then env, then defaults).",
    });
  });

  router.put("/api/settings", async (req, res) => {
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn before saving settings." });
      return;
    }
    const body = req.body as {
      harness?: { env?: Record<string, string> };
      provider?: { model?: string; baseURL?: string };
    };
    const prefs = bridge.harness.getRuntimePreferences();
    const envIn = body.harness?.env;
    const envPatch: Record<string, string> = {};
    if (envIn && typeof envIn === "object") {
      for (const [k, v] of Object.entries(envIn)) {
        if (!HARNESS_MANAGED_ENV_KEY_SET.has(k)) continue;
        if (harnessEnvResolutionMeta(k, prefs).lockedByEnv) continue;
        if (typeof v !== "string") continue;
        envPatch[k] = v.trim().slice(0, 8000);
      }
    }
    const patch: Partial<import("@liminal/core").RuntimePreferences> = {};
    if (Object.keys(envPatch).length > 0) {
      patch.harness = { env: envPatch };
    }
    if (body.provider && typeof body.provider === "object") {
      const modelLocked = !!(process.env["AGENT_MODEL"]?.trim());
      const baseLocked = !!(process.env["AGENT_API_BASE_URL"]?.trim());
      const pm =
        typeof body.provider.model === "string" ? body.provider.model.trim().slice(0, 200) : "";
      const pb =
        typeof body.provider.baseURL === "string" ? body.provider.baseURL.trim().slice(0, 500) : "";
      const prov: { model?: string; baseURL?: string } = {};
      if (!modelLocked && pm.length > 0) prov.model = pm;
      if (!baseLocked && pb.length > 0) prov.baseURL = pb;
      if (Object.keys(prov).length > 0) patch.provider = prov;
    }
    if (!patch.harness && !patch.provider) {
      res.status(400).json({ error: "No valid harness.env or provider fields in body." });
      return;
    }
    try {
      await bridge.harness.patchRuntimePreferences(patch, { persist: true });
      res.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save settings.";
      res.status(400).json({ error: message });
    }
  });

  router.post("/api/session/reset", (req, res) => {
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; wait for the current turn to finish." });
      return;
    }
    const body = req.body as { mode?: string; greet?: boolean } | undefined;
    const mode = String(body?.mode ?? "soft").toLowerCase();
    if (mode === "hard") {
      bridge.clearSession({ preserveBootstrapState: false });
      res.json({ ok: true, mode: "hard" });
      void bridge.initializeSessionAfterReset().catch((err) => {
        sse.send("error", {
          message: err instanceof Error ? err.message : "Session greeting failed after reset.",
        });
      });
      return;
    }
    // Default: soft reset — clear transcript only.
    // greet=true (sent on fresh page load) triggers a session greeting after clearing.
    const greet = body?.greet === true;
    bridge.clearSession({ preserveBootstrapState: true });
    res.json({ ok: true, mode: "soft" });
    if (greet && !bridge.isAwaitingPersonaBootstrap) {
      void bridge.harness.sendSessionGreeting().catch((err) => {
        sse.send("error", {
          message: err instanceof Error ? err.message : "Session greeting failed.",
        });
      });
    }
  });

  router.post("/api/session/abort", (_req, res) => {
    if (!bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "No turn in progress to abort." });
      return;
    }
    bridge.harness.abortCurrentTurn();
    res.json({ ok: true });
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
    await bridge.whenSessionReady();
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
      await bridge.whenSessionReady();
      await bridge.submitPersonaBootstrap(String(input ?? ""), { skip: Boolean(skip) });
      res.json({ ok: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Persona bootstrap failed.";
      const isTimeout = /aborted|timeout|timed out/i.test(message);
      const isConflict =
        /already in progress|still initializing|already processing/i.test(message);
      const status = isConflict ? 409 : isTimeout ? 504 : 400;
      const payload = {
        error: isTimeout
          ? "Persona generation timed out. Please retry (or reduce prompt complexity)."
          : message,
        detail: message,
      };
      try {
        res.status(status).json(payload);
      } catch (sendErr) {
        console.error("persona/bootstrap: failed to send JSON error body:", sendErr);
        if (!res.headersSent) res.status(500).end();
      }
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
    try {
      res.json({
        clients: sse.clientCount,
        busy: bridge.isBusy,
        startedAt: bridge.turnStartTime,
        lastTurnEndedAt: bridge.lastTurnEndedAt,
      });
    } catch (err) {
      console.error("[status] failed:", err);
      res.status(500).json({ error: "status unavailable" });
    }
  });

  return router;
}
