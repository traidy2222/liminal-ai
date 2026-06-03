import { Router } from "express";
import { randomBytes } from "node:crypto";
import type { ChatManager } from "./chatManager.js";
import type { SSEManager } from "./sse.js";
import type { ApprovalDecision, ChatWorkspaceMode } from "@liminal/core";
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
  listChats,
  listOrphanChatIds,
  readChatMetadata,
  workspaceFingerprint,
  resolveTranscriptionConfigAsync,
  transcribeAudio,
  resolveSpeechSynthesisConfigAsync,
  synthesizeSpeechMulti,
  sanitizeTextForTts,
  coerceTtsConfigForBrowserPlayback,
  applyVireonLicenseToken,
  readVireonAccount,
  loadHarnessEntitlements,
  defaultVireonSiteOrigin,
  clearVireonAccount,
  fetchInferenceUsageStatus,
  resolveInferenceMode,
} from "@liminal/core";
import {
  saveAudioAttachment,
  findAudioAttachment,
  readAudioAttachment,
  normalizeAudioMimeType,
  SUPPORTED_AUDIO_MIME_TYPES,
  saveTtsClip,
  readTtsClip,
  ttsClipAudioUrl,
} from "@liminal/tools";
import { loadPersonaUiThemeFromWorkspace } from "@liminal/tools";
import { persistIncomingAttachments } from "./image_attachment_store.js";
import type { LocalWebAuth } from "./local_auth.js";
import path from "node:path";

const WEB_PORT = Number(process.env["PORT"] ?? 3001);

/** Strip path segments and dangerous chars; cap length for safe storage/display. */
function sanitizeAudioFilename(raw: string): string {
  const base = path.basename(String(raw ?? "").trim());
  const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\.+/, "");
  const trimmed = cleaned.slice(0, 120);
  return trimmed || `audio-${Date.now()}.webm`;
}

type IncomingAttachment = {
  name?: string;
  dataUrl?: string;
  source?: "clipboard" | "drop" | "path" | "command";
};

/**
 * Build the HTTP router. Every endpoint that operates on a chat resolves the
 * active bridge through `chatManager.getActive()` so a single client can hop
 * between chats by calling `POST /api/chats/:id/activate` — subsequent
 * `/api/message`, `/api/approve`, etc. land in the newly-active chat.
 */
/** Short-lived state nonces for /connect/harness → local callback. */
const pendingHarnessConnect = new Map<
  string,
  { exp: number; redirectUri: string }
>();

function prunePendingHarnessConnect(): void {
  const now = Date.now();
  for (const [k, v] of pendingHarnessConnect) {
    if (v.exp < now) pendingHarnessConnect.delete(k);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isAllowedVireonRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.protocol !== "http:") return false;
    const host = u.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "[::1]";
  } catch {
    return false;
  }
}

function vireonCallbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/api/vireon/auth/callback`;
}

export function createRouter(
  chatManager: ChatManager,
  sse: SSEManager,
  localAuth: LocalWebAuth
): Router {
  const router = Router();

  /** Convenience wrapper — every chat-scoped route calls this. */
  const active = () => chatManager.getActive();

  router.get("/api/config", async (_req, res) => {
    try {
      const bridge = active();
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
      // Surface the active chat so the client can populate its header chip on
      // first paint without a separate roundtrip.
      const activeMeta = await readChatMetadata(bridge.chatId);
      res.json({
        webAuthToken: localAuth.token,
        uiVerbosity: uiRaw === "quiet" ? "quiet" : "normal",
        approvalTimeoutMs: bridge.harness.getApprovalTimeoutMs(),
        personaBootstrapEnabled: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP", prefs) !== "0",
        personaBootstrapPending: bridge.isAwaitingPersonaBootstrap,
        personaBootstrapAllowSkip: resolveHarnessEnvRaw("AGENT_PERSONA_BOOTSTRAP_ALLOW_SKIP", prefs) !== "0",
        personaUiTheme,
        personaDisplayLabel,
        personalityHeartbeatEnabled: ph.enabled,
        personalityHeartbeatUiStrip: ph.uiStripDefault,
        dictationAudioCue: resolveHarnessEnvRaw("AGENT_DICTATION_AUDIO_CUE", prefs) === "1",
        dictationWebSpeech: resolveHarnessEnvRaw("AGENT_DICTATION_WEB_SPEECH", prefs) !== "0",
        ttsEnabled: resolveHarnessEnvRaw("AGENT_TTS_ENABLED", prefs) === "1",
        ttsVoice: resolveHarnessEnvRaw("AGENT_TTS_VOICE", prefs)?.trim() || "af_sky",
        // New in Phase 2: which chat is the SSE stream currently bound to.
        activeChat: activeMeta
          ? {
              chatId: activeMeta.chatId,
              title: activeMeta.title,
              workspaceMode: activeMeta.workspaceMode,
              workspaceRoot: activeMeta.workspaceRoot,
              workspaceBasename: path.basename(activeMeta.workspaceRoot),
              workspaceFingerprint: activeMeta.workspaceFingerprint,
            }
          : null,
      });
    } catch (err) {
      console.error("/api/config failed:", err instanceof Error ? err.stack ?? err.message : String(err));
      res.status(200).json({
        webAuthToken: localAuth.token,
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
    const bridge = active();
    const prefs = bridge.harness.getRuntimePreferences();
    const fields = buildHarnessSettingsApiFields(prefs);
    const cfg = bridge.harness.config;
    const envModel = process.env["AGENT_MODEL"]?.trim();
    const envBase = process.env["AGENT_API_BASE_URL"]?.trim();
    const apiKeyConfigured = !!(cfg.openRouterApiKey && cfg.openRouterApiKey.trim().length > 0);
    const managedRoute = (cfg.baseURL ?? "").includes("/inference");
    res.json({
      tabs: HARNESS_SETTINGS_TABS,
      fields,
      provider: {
        model: (cfg.model ?? "").slice(0, 200),
        baseURL: (cfg.baseURL ?? "").slice(0, 500),
        modelLockedByEnv: !!envModel,
        baseURLLockedByEnv: !!envBase,
        apiKeyConfigured,
        managedRoute,
        inferenceMode: resolveInferenceMode(prefs),
      },
      hint:
        "API keys are never shown here — only whether one loaded. Sign in to Vireon (Settings) for Pro license + managed inference, or set BYOK keys in `.env`.",
    });
  });

  router.get("/api/vireon/inference-status", async (_req, res) => {
    try {
      const status = await fetchInferenceUsageStatus();
      res.json(
        status ?? {
          configured: false,
          entitled: false,
          reason: "Not signed in to Vireon",
          remainingUsd: null,
          capUsd: null,
          usedUsd: null,
          periodEnd: null,
        }
      );
    } catch (e) {
      res.status(400).json({
        error: e instanceof Error ? e.message : "Inference status failed",
      });
    }
  });

  router.get("/api/vireon/account", async (_req, res) => {
    const account = await readVireonAccount();
    const ent = await loadHarnessEntitlements();
    res.json({
      connected: Boolean(account),
      account,
      tier: ent.tier,
      licensed: Boolean(ent.license),
      entitlements: [...ent.entitlements],
    });
  });

  router.get("/api/vireon/connect/begin", (req, res) => {
    prunePendingHarnessConnect();
    const state = randomBytes(16).toString("hex");
    const redirectUri = vireonCallbackRedirectUri(WEB_PORT);
    pendingHarnessConnect.set(state, { exp: Date.now() + 5 * 60_000, redirectUri });
    const site = defaultVireonSiteOrigin();
    const connectUrl = `${site}/connect/harness?redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`;
    res.json({ connectUrl, state });
  });

  const vireonCallbackHtml = (title: string, bodyHtml: string) =>
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #e8e8e8; background: #0a0a0a; }
    h1 { font-size: 1.25rem; margin-bottom: 0.75rem; }
    p { color: #aaa; line-height: 1.5; margin: 0 0 0.75rem; }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <p>${bodyHtml}</p>
</body>
</html>`;

  const vireonCallbackSuccessRedirect = (email: string, tier: string) =>
    `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="0;url=/?vireon=connected" />
  <title>Connected — returning to Liminal</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 3rem auto; padding: 0 1rem; color: #e8e8e8; background: #0a0a0a; }
    p { color: #aaa; line-height: 1.5; }
    a { color: #7dd3fc; }
  </style>
</head>
<body>
  <p>Connected as <strong>${escapeHtml(email)}</strong> (${escapeHtml(tier)}). Returning to Liminal chat…</p>
  <p><a href="/?vireon=connected">Continue to chat</a> if you are not redirected.</p>
  <script>
  (function () {
    var target = "/?vireon=connected";
    try {
      if (window.opener && !window.opener.closed) {
        window.opener.location.replace(target);
        window.close();
        return;
      }
    } catch (e) {}
    window.location.replace(target);
  })();
  </script>
</body>
</html>`;

  const readVireonCallbackParams = (req: import("express").Request) => {
    if (req.method === "GET") {
      const q = req.query;
      return {
        token: typeof q["token"] === "string" ? q["token"].trim() : "",
        state: typeof q["state"] === "string" ? q["state"].trim() : "",
        licenseSub: typeof q["licenseSub"] === "string" ? q["licenseSub"].trim() : undefined,
        email: typeof q["email"] === "string" ? q["email"].trim() : undefined,
      };
    }
    return {
      token: typeof req.body?.token === "string" ? req.body.token.trim() : "",
      state: typeof req.body?.state === "string" ? req.body.state.trim() : "",
      licenseSub:
        typeof req.body?.licenseSub === "string" ? req.body.licenseSub.trim() : undefined,
      email: typeof req.body?.email === "string" ? req.body.email.trim() : undefined,
    };
  };

  const respondVireonCallbackError = (
    req: import("express").Request,
    res: import("express").Response,
    status: number,
    message: string
  ) => {
    if (req.method === "GET") {
      res
        .status(status)
        .type("html")
        .send(
          vireonCallbackHtml(
            "Could not connect Liminal",
            `${escapeHtml(message)} <a href="/">Return to Liminal chat</a>`
          )
        );
      return;
    }
    res.status(status).json({ error: message });
  };

  const handleVireonAuthCallback = async (
    req: import("express").Request,
    res: import("express").Response
  ) => {
    prunePendingHarnessConnect();
    const { token, state, licenseSub, email } = readVireonCallbackParams(req);
    const pending = state ? pendingHarnessConnect.get(state) : undefined;
    if (!state || !pending || pending.exp < Date.now()) {
      respondVireonCallbackError(req, res, 403, "Invalid or expired connect session");
      return;
    }
    const requestUri = `${req.protocol}://${req.get("host") ?? "127.0.0.1"}${req.originalUrl.split("?")[0]}`;
    if (
      !isAllowedVireonRedirectUri(requestUri) &&
      requestUri !== pending.redirectUri
    ) {
      respondVireonCallbackError(req, res, 403, "Invalid callback redirect URI");
      return;
    }
    if (!token) {
      respondVireonCallbackError(
        req,
        res,
        400,
        req.method === "GET" ? "token required in query string" : "token required in POST body"
      );
      return;
    }
    const resolvedEmail = email?.trim() || "vireon@user";
    try {
      const resolved = await applyVireonLicenseToken(token, {
        email: resolvedEmail,
        source: "browser",
        licenseSub,
      });
      pendingHarnessConnect.delete(state);
      await chatManager.reloadRuntimePrefs();
      try {
        await chatManager.reapplyActiveBridgeProvider();
      } catch (e) {
        console.warn("[vireon] bridge provider refresh:", e instanceof Error ? e.message : e);
      }
      if (req.method === "GET") {
        res
          .status(200)
          .type("html")
          .send(vireonCallbackSuccessRedirect(resolvedEmail, resolved.tier));
        return;
      }
      res.json({ ok: true, tier: resolved.tier, email: resolvedEmail });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Connect failed";
      respondVireonCallbackError(req, res, 400, message);
    }
  };

  router.get("/api/vireon/auth/callback", (req, res) => {
    void handleVireonAuthCallback(req, res);
  });

  router.post("/api/vireon/auth/callback", (req, res) => {
    void handleVireonAuthCallback(req, res);
  });

  router.post("/api/vireon/logout", async (_req, res) => {
    await clearVireonAccount();
    await chatManager.reloadRuntimePrefs();
    res.json({ ok: true });
  });

  router.post("/api/vireon/reconnect", async (_req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy." });
      return;
    }
    try {
      await chatManager.reapplyActiveBridgeProvider();
      res.json({ ok: true });
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : "Reconnect failed" });
    }
  });

  router.put("/api/settings", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn before saving settings." });
      return;
    }
    const body = req.body as {
      harness?: { env?: Record<string, string> };
      provider?: { model?: string; baseURL?: string; inferenceMode?: string };
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
      const prov: { model?: string; baseURL?: string; inferenceMode?: "byok" | "managed" | "auto" } =
        {};
      if (!modelLocked && pm.length > 0) prov.model = pm;
      if (!baseLocked && pb.length > 0) prov.baseURL = pb;
      const modeRaw =
        typeof body.provider.inferenceMode === "string"
          ? body.provider.inferenceMode.trim().toLowerCase()
          : "";
      if (modeRaw === "byok" || modeRaw === "managed" || modeRaw === "auto") {
        prov.inferenceMode = modeRaw;
      }
      if (Object.keys(prov).length > 0) patch.provider = { ...prefs?.provider, ...prov };
    }
    if (!patch.harness && !patch.provider) {
      res.status(400).json({ error: "No valid harness.env or provider fields in body." });
      return;
    }
    try {
      await bridge.harness.patchRuntimePreferences(patch, { persist: true });
      // Surface updated prefs to the chat manager so newly-constructed bridges
      // (after idle eviction or new chat creation) pick them up.
      await chatManager.reloadRuntimePrefs();
      res.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save settings.";
      res.status(400).json({ error: message });
    }
  });

  router.post("/api/session/reset", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; wait for the current turn to finish." });
      return;
    }
    const body = req.body as { mode?: string; greet?: boolean } | undefined;
    const mode = String(body?.mode ?? "soft").toLowerCase();
    if (mode === "hard") {
      bridge.clearSession({ preserveBootstrapState: false });
      sse.clearHistory(bridge.chatId);
      res.json({ ok: true, mode: "hard" });
      void bridge.initializeSessionAfterReset().catch((err) => {
        sse.send(
          "error",
          {
            message: err instanceof Error ? err.message : "Session greeting failed after reset.",
          },
          bridge.chatId
        );
      });
      return;
    }
    const greet = body?.greet === true;
    bridge.clearSession({ preserveBootstrapState: true });
    sse.clearHistory(bridge.chatId);
    let greeted = false;
    if (greet && !bridge.isAwaitingPersonaBootstrap) {
      // Non-blocking: start the greeting turn and return immediately. The heartbeat
      // fires harness_running synchronously so the client shows busy state at once;
      // greeting content streams over SSE. Awaiting here would hang the reset call
      // for the entire turn.
      bridge.beginGreeting();
      greeted = true;
    }
    res.json({ ok: true, mode: "soft", greeted });
  });

  router.post("/api/session/abort", (_req, res) => {
    const bridge = active();
    if (!bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "No turn in progress to abort." });
      return;
    }
    bridge.harness.abortCurrentTurn();
    res.json({ ok: true });
  });

  router.get("/api/stream", (req, res) => {
    req.socket.setKeepAlive(true, 15_000);
    req.socket.setTimeout(0);
    let chatId = "";
    try {
      chatId = chatManager.activeId;
    } catch {
      res.status(503).json({ error: "No active chat" });
      return;
    }
    sse.add(req, res, chatId);
    let bridge: import("./agentBridge.js").AgentBridge | null = null;
    try {
      bridge = chatManager.getActive();
    } catch {
      /* no active chat yet — fine */
    }
    if (bridge) {
      // Do NOT emit `chat_switched` here — that event clears the client transcript.
      // Chat switches are announced only from ChatManager.activate(). New stream
      // clients load active chat via GET /api/config and /api/chats.
      if (bridge.isBusy) {
        res.write(
          `event: harness_running\ndata: ${JSON.stringify({ startedAt: bridge.turnStartTime })}\n\n`
        );
      }
    }
  });

  router.post("/api/message", async (req, res) => {
    const bridge = active();
    await bridge.whenSessionReady();
    if (bridge.isAwaitingPersonaBootstrap) {
      res.status(409).json({ error: "Persona bootstrap is pending. Submit via bootstrap modal." });
      return;
    }
    const { message, freshContext, attachments, liveDictation } = req.body as {
      message?: string;
      freshContext?: boolean;
      attachments?: IncomingAttachment[];
      liveDictation?: boolean;
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
    res.json({ ok: true });
    bridge
      .sendUserMessage(normalizedMessage, {
        freshContext: Boolean(freshContext),
        liveDictation: Boolean(liveDictation),
      })
      .catch((err) => {
      const message = err instanceof Error ? err.message : "Failed to process message.";
      sse.send("error", { message }, bridge.chatId);
    });
  });

  router.post("/api/persona/bootstrap", async (req, res) => {
    const bridge = active();
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
    const bridge = active();
    const { callId, decision, approvalNonce } = req.body as {
      callId?: string;
      decision?: ApprovalDecision;
      approvalNonce?: string;
    };
    if (!callId || !decision) {
      res.status(400).json({ error: "callId and decision required" });
      return;
    }
    if (!approvalNonce || typeof approvalNonce !== "string") {
      res.status(400).json({ error: "approvalNonce required" });
      return;
    }
    const resolved = bridge.resolveApproval(callId, decision, approvalNonce);
    res.json({ ok: resolved });
  });

  router.post("/api/answer", (req, res) => {
    const bridge = active();
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
      const bridge = active();
      res.json({
        clients: sse.clientCount,
        busy: bridge.isBusy,
        startedAt: bridge.turnStartTime,
        lastTurnEndedAt: bridge.lastTurnEndedAt,
        activeChatId: bridge.chatId,
        residentChatIds: chatManager.getResidentBridgeIds(),
      });
    } catch (err) {
      console.error("[status] failed:", err);
      res.status(500).json({ error: "status unavailable" });
    }
  });

  // ─── Per-chat workspaces ──────────────────────────────────────────────────

  router.get("/api/workspace/current", async (_req, res) => {
    try {
      const bridge = active();
      const meta = await readChatMetadata(bridge.chatId);
      res.json({
        chatId: bridge.chatId,
        workspaceRoot: bridge.workspaceRoot,
        workspaceFingerprint: workspaceFingerprint(bridge.workspaceRoot),
        basename: path.basename(bridge.workspaceRoot),
        meta,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/api/chats", async (_req, res) => {
    try {
      const [chats, orphanIds] = await Promise.all([listChats(), listOrphanChatIds()]);
      res.json({
        chats,
        orphanIds,
        activeChatId: chatManager.activeId || null,
        residentChatIds: chatManager.getResidentBridgeIds(),
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/api/chats/:id", async (req, res) => {
    try {
      const meta = await readChatMetadata(req.params.id);
      if (!meta) {
        res.status(404).json({ error: "chat not found" });
        return;
      }
      res.json({ meta });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/api/chats", async (req, res) => {
    try {
      const { title, workspaceMode, workspaceRoot, activate: shouldActivate } = req.body as {
        title?: string;
        workspaceMode?: ChatWorkspaceMode;
        workspaceRoot?: string;
        activate?: boolean;
      };
      const mode: ChatWorkspaceMode =
        workspaceMode === "folder" || workspaceMode === "reuse" ? workspaceMode : "scratch";
      // Validate folder existence here (manager assumes valid input).
      if (mode === "folder") {
        if (!workspaceRoot) {
          res.status(400).json({ error: "workspaceRoot required for folder mode" });
          return;
        }
        const { stat } = await import("node:fs/promises");
        try {
          const s = await stat(path.resolve(workspaceRoot));
          if (!s.isDirectory()) throw new Error("not a directory");
        } catch {
          res.status(400).json({
            error: `workspaceRoot does not exist or is not a directory: ${path.resolve(workspaceRoot)}`,
          });
          return;
        }
      }
      const meta = await chatManager.create({ title, workspaceMode: mode, workspaceRoot });
      if (shouldActivate !== false) {
        await chatManager.activate(meta.chatId);
      }
      res.json({ meta, activated: shouldActivate !== false });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/api/chats/:id/activate", async (req, res) => {
    try {
      const meta = await chatManager.activate(req.params.id);
      res.json({ meta });
    } catch (err) {
      const message = (err as Error).message;
      const status = /not found/.test(message) ? 404 : 500;
      res.status(status).json({ error: message });
    }
  });

  router.delete("/api/chats/:id", async (req, res) => {
    try {
      const result = await chatManager.delete(req.params.id);
      res.json({ ok: true, newActiveId: result.newActiveId });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // ─── Audio transcription ──────────────────────────────────────────────────
  //
  // Two endpoints, mirroring the image attachment pattern (base64 data URL
  // body to avoid pulling in multer):
  //   POST /api/audio/upload    → persist audio under per-chat dir, return id
  //   POST /api/transcribe      → run ASR on a previously-uploaded id
  //
  // Both resolve the chat via chatManager.getActive() so multi-chat works:
  // each chat has its own audio dir under ~/.liminal/chats/<id>/audio/.

  router.post("/api/audio/upload", async (req, res) => {
    try {
      const bridge = active();
      const body = req.body as {
        dataUrl?: string;
        filename?: string;
        mimeType?: string;
      };
      const dataUrl = String(body.dataUrl ?? "").trim();
      if (!dataUrl.startsWith("data:")) {
        res.status(400).json({ error: "dataUrl required (data:<mime>;base64,<payload>)" });
        return;
      }
      // MediaRecorder produces mime types like `audio/webm;codecs=opus`, which
      // adds a parameter segment before `;base64,`. The previous regex
      // /^data:([^;]+);base64,(.+)$/ failed on these because [^;]+ stopped at
      // the FIRST semicolon. The new pattern grabs everything between `data:`
      // and the LAST `;base64,` so codec/charset parameters survive intact.
      const base64Idx = dataUrl.indexOf(";base64,");
      if (base64Idx < 5) {
        res.status(400).json({ error: "Invalid data URL format (expected ;base64, segment)" });
        return;
      }
      const fullMimeHeader = dataUrl.slice(5, base64Idx); // strip "data:" prefix
      const payload = dataUrl.slice(base64Idx + ";base64,".length);
      if (!fullMimeHeader || !payload) {
        res.status(400).json({ error: "Invalid data URL format" });
        return;
      }
      // Extract just the media type (drop ;codecs=…, ;charset=…) for our
      // allow-list check. Keep the full header for content-type if we ever
      // need it downstream.
      const mimeFromUrl = normalizeAudioMimeType(fullMimeHeader);
      const bodyMime =
        typeof body.mimeType === "string" ? normalizeAudioMimeType(body.mimeType) : "";
      // Trust the data URL MIME only; ignore a mismatched client-supplied mimeType.
      const mimeType =
        bodyMime && bodyMime === mimeFromUrl ? bodyMime : mimeFromUrl;
      if (!mimeType || !SUPPORTED_AUDIO_MIME_TYPES.has(mimeType)) {
        res.status(400).json({
          error: `Unsupported audio MIME: ${fullMimeHeader}. Supported: ${[...SUPPORTED_AUDIO_MIME_TYPES].join(", ")}`,
        });
        return;
      }
      const bytes = Buffer.from(payload, "base64");
      const config = await resolveTranscriptionConfigAsync(bridge.harness.getRuntimePreferences());
      if (bytes.byteLength > config.maxBytes) {
        res.status(413).json({
          error: `Audio file ${bytes.byteLength} bytes exceeds AGENT_TRANSCRIBE_MAX_BYTES (${config.maxBytes}).`,
        });
        return;
      }
      const filename = sanitizeAudioFilename(
        (typeof body.filename === "string" && body.filename.trim()) || `audio-${Date.now()}.webm`
      );
      const rec = await saveAudioAttachment(bridge.chatId, {
        bytes,
        filename,
        mimeType,
      });
      res.json({
        ok: true,
        attachmentId: rec.id,
        filename: rec.filename,
        mimeType: rec.mimeType,
        sizeBytes: rec.sizeBytes,
        chatId: bridge.chatId,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/api/transcribe", async (req, res) => {
    try {
      const bridge = active();
      const body = req.body as {
        attachmentId?: string;
        language?: string;
        prompt?: string;
        timestamps?: "none" | "segment" | "word";
        model?: string;
      };
      const id = String(body.attachmentId ?? "").trim();
      if (!id) {
        res.status(400).json({ error: "attachmentId required (upload first via /api/audio/upload)" });
        return;
      }
      const found = await findAudioAttachment(bridge.chatId, id);
      if (!found) {
        res.status(404).json({ error: `Audio attachment ${id} not found for this chat.` });
        return;
      }
      const { record, bytes } = await readAudioAttachment(bridge.chatId, id);
      const config = await resolveTranscriptionConfigAsync(bridge.harness.getRuntimePreferences());
      if (!config.enabled) {
        res.status(503).json({ error: "Transcription disabled (AGENT_TRANSCRIBE_ENABLED=0)." });
        return;
      }
      if (!config.apiKey) {
        res.status(503).json({
          error: "No transcription API key. Set AGENT_TRANSCRIBE_API_KEY, AGENT_API_KEY, or OPENROUTER_API_KEY.",
        });
        return;
      }
      const result = await transcribeAudio(
        {
          audio: bytes,
          filename: record.filename,
          language: body.language?.trim() || undefined,
          prompt: body.prompt?.slice(0, 1500),
          timestamps:
            body.timestamps === "none" || body.timestamps === "word" || body.timestamps === "segment"
              ? body.timestamps
              : undefined,
          model: body.model?.trim() || undefined,
        },
        config
      );
      // Surface to SSE so the client UI's cost chip stays in sync even if the
      // browser tab that triggered the call already moved on.
      sse.send(
        "transcription",
        {
          chatId: bridge.chatId,
          attachmentId: id,
          durationSec: result.durationSec,
          costUsd: result.costUsd,
          model: result.model,
          language: result.language,
          at: Date.now(),
        },
        bridge.chatId
      );
      res.json({
        ok: true,
        attachmentId: id,
        text: result.text,
        language: result.language,
        durationSec: result.durationSec,
        costUsd: result.costUsd,
        model: result.model,
        provider: result.provider,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/api/tts", async (req, res) => {
    try {
      const bridge = active();
      const body = req.body as { text?: string; voice?: string };
      const raw = String(body.text ?? "").trim();
      if (!raw) {
        res.status(400).json({ error: "text required" });
        return;
      }
      const prefs = bridge.harness.getRuntimePreferences();
      const config = await resolveSpeechSynthesisConfigAsync(prefs);
      if (!config.enabled) {
        res.status(400).json({ error: "TTS is disabled (AGENT_TTS_ENABLED=0)." });
        return;
      }
      const sanitized = sanitizeTextForTts(raw, config.maxCharsPerCall);
      if (!sanitized) {
        res.status(400).json({ error: "Nothing to speak after sanitization." });
        return;
      }
      const multi = await synthesizeSpeechMulti(
        { text: sanitized, voice: body.voice?.trim() || undefined },
        coerceTtsConfigForBrowserPlayback(config)
      );
      const clips = [];
      for (const seg of multi.segments) {
        const saved = await saveTtsClip(bridge.chatId, seg.audio, seg.mimeType, seg.spokenText);
        clips.push({
          clipId: saved.clipId,
          audioUrl: ttsClipAudioUrl(saved.clipId),
          text: seg.spokenText,
          cacheHit: saved.cacheHit,
        });
      }
      res.json({
        ok: true,
        segments: clips.length,
        clips,
        charCount: multi.charCount,
        costUsd: multi.costUsd,
      });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/api/tts/clip/:clipId", async (req, res) => {
    try {
      const bridge = active();
      const clipId = String(req.params.clipId ?? "");
      const clip = await readTtsClip(bridge.chatId, clipId);
      if (!clip) {
        res.status(404).json({ error: "clip not found" });
        return;
      }
      res.setHeader("Content-Type", clip.mimeType);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(clip.bytes);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  return router;
}
