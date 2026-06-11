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
  loadChatTranscriptFromSessionLog,
  readChatMetadata,
  workspaceFingerprint,
  applyVireonLicenseToken,
  readVireonAccount,
  loadHarnessEntitlements,
  defaultVireonSiteOrigin,
  clearVireonAccount,
  fetchInferenceUsageStatus,
  resolveInferenceMode,
  listGoogleOAuthAccounts,
  exchangeGoogleCode,
  ALL_GOOGLE_SERVICE_IDS,
  scopesForGoogleServices,
  resolveGoogleServices,
  listMicrosoftOAuthAccounts,
  ALL_MICROSOFT_SERVICE_IDS,
  missingDefaultMicrosoftScopes,
  listGithubOAuthAccounts,
  listXeroOAuthAccounts,
  xeroBundleMissingCoreScopes,
  xeroBundleMissingPhase3Scopes,
  xeroBundleMissingScopes,
  listSlackOAuthAccounts,
  missingSlackScopes,
  slackHostedConnectExtra,
  listLinearOAuthAccounts,
  listNotionOAuthAccounts,
  buildHostedIntegrationConnectUrl,
  hostedOAuthHandoffPath,
  applyHostedOAuthHandoff,
  isHostedOAuthFormHandoffContent,
  parseHostedOAuthHandoffHttpBody,
} from "@liminal/core";
import {
  handleAudioUpload,
  handleTranscribe,
  handleTtsPost,
  readTtsClipBytes,
  getGoogleSidecarStatus,
  getMicrosoftSidecarStatus,
  connectGoogleWorkspaceFromServer,
  disconnectGoogleWorkspaceFromServer,
  connectMicrosoft365FromServer,
  disconnectMicrosoft365FromServer,
  connectGithubFromServer,
  disconnectGithubFromServer,
  connectXeroFromServer,
  disconnectXeroFromServer,
  connectSlackFromServer,
  disconnectSlackFromServer,
  connectLinearFromServer,
  disconnectLinearFromServer,
  connectNotionFromServer,
  disconnectNotionFromServer,
  listIntegrationConnections,
  attachCustomMcpFromServer,
  detachCustomMcpFromServer,
  connectOpenApiFromServer,
  disconnectOpenApiFromServer,
  parseAuthBody,
} from "@liminal/tools";
import { loadPersonaUiThemeFromWorkspace, loadPersonaUiCopyFromWorkspace } from "@liminal/tools";
import { persistIncomingAttachments } from "./image_attachment_store.js";
import type { LocalWebAuth } from "./local_auth.js";
import path from "node:path";

const WEB_PORT = Number(process.env["PORT"] ?? 3001);

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

const pendingGoogleConnect = new Map<
  string,
  { exp: number; redirectUri: string; services?: string[]; mode: "read_write" | "read_only" }
>();

const pendingHostedOAuth = new Map<
  string,
  {
    exp: number;
    provider: string;
    mode: "read_write" | "read_only";
    services?: string[];
  }
>();

function prunePendingHostedOAuth(): void {
  const now = Date.now();
  for (const [k, v] of pendingHostedOAuth) {
    if (v.exp < now) pendingHostedOAuth.delete(k);
  }
}

function prunePendingGoogleConnect(): void {
  const now = Date.now();
  for (const [k, v] of pendingGoogleConnect) {
    if (v.exp < now) pendingGoogleConnect.delete(k);
  }
}

function googleCallbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}/oauth/google/callback`;
}

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
      // Do not block the web shell on tool registration + beginSession (10–30s cold start).
      // SSE `connected` and a follow-up config fetch refresh persona/bootstrap fields.
      void bridge.whenSessionReady().catch((err) => {
        console.warn("[config] session ready deferred:", err instanceof Error ? err.message : err);
      });
      const prefs = bridge.harness.getRuntimePreferences();
      const uiRaw = resolveHarnessEnvRaw("AGENT_UI_VERBOSITY", prefs)?.trim();
      let personaUiTheme: import("@liminal/core").PersonaUiThemeV2 | null = null;
      try {
        personaUiTheme = await loadPersonaUiThemeFromWorkspace();
      } catch {
        personaUiTheme = null;
      }
      let personaUiCopy: import("@liminal/core").PersonaUiCopy | null = null;
      try {
        personaUiCopy = await loadPersonaUiCopyFromWorkspace();
      } catch {
        personaUiCopy = null;
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
        personaUiCopy,
        personaDisplayLabel,
        personalityHeartbeatEnabled: ph.enabled,
        personalityHeartbeatUiStrip: ph.uiStripDefault,
        dictationAudioCue: resolveHarnessEnvRaw("AGENT_DICTATION_AUDIO_CUE", prefs) === "1",
        dictationWebSpeech: resolveHarnessEnvRaw("AGENT_DICTATION_WEB_SPEECH", prefs) !== "0",
        ttsEnabled: resolveHarnessEnvRaw("AGENT_TTS_ENABLED", prefs) === "1",
        ttsVoice: resolveHarnessEnvRaw("AGENT_TTS_VOICE", prefs)?.trim() || "af_sky",
        sessionGreetEnabled: resolveHarnessEnvRaw("AGENT_SESSION_GREET", prefs) === "1",
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
        sessionGreetEnabled: false,
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
    const apiKeyConfigured = !!(cfg.openRouterApiKey && cfg.openRouterApiKey.trim().length > 0);
    const managedRoute = (cfg.baseURL ?? "").includes("/inference");
    res.json({
      tabs: HARNESS_SETTINGS_TABS,
      fields,
      provider: {
        model: (cfg.model ?? "").slice(0, 200),
        baseURL: (cfg.baseURL ?? "").slice(0, 500),
        modelLockedByEnv: false,
        baseURLLockedByEnv: false,
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
    const orgId = ent.license?.org?.trim() || null;
    const teamMemoryEntitled = ent.entitlements.has("team.shared_memory");
    const teamMemorySyncOn = process.env["AGENT_TEAM_MEMORY_SYNC"] !== "0";
    let teamMemoryStatus: "active" | "offline" | "not_entitled" = "not_entitled";
    if (teamMemoryEntitled) {
      teamMemoryStatus = orgId && teamMemorySyncOn ? "active" : "offline";
    }
    res.json({
      connected: Boolean(account),
      account,
      tier: ent.tier,
      licensed: Boolean(ent.license),
      entitlements: [...ent.entitlements],
      orgId,
      teamMemory: {
        status: teamMemoryStatus,
        orgBound: Boolean(orgId),
        syncEnabled: teamMemorySyncOn,
      },
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

  router.get("/api/integrations", async (_req, res) => {
    try {
      const accounts = await listGoogleOAuthAccounts();
      const msAccounts = await listMicrosoftOAuthAccounts();
      const sidecar = await getGoogleSidecarStatus();
      const msSidecar = await getMicrosoftSidecarStatus();
      const connections = await listIntegrationConnections();
      const { missingDefaultWorkspaceScopes } = await import("@liminal/core");
      res.json({
        google: {
          accounts: accounts.map((a) => ({
            ...a,
            missingScopes: missingDefaultWorkspaceScopes(a.scopes),
          })),
          sidecar,
          services: ALL_GOOGLE_SERVICE_IDS,
        },
        microsoft: {
          accounts: msAccounts.map((a) => ({
            ...a,
            missingScopes: missingDefaultMicrosoftScopes(a.scopes),
          })),
          sidecar: msSidecar,
          services: ALL_MICROSOFT_SERVICE_IDS,
        },
        github: {
          accounts: (await listGithubOAuthAccounts()).map((a) => ({
            accountId: a.accountId,
            email: a.email,
            login: a.login,
            scopes: a.scopes,
            expiresAt: a.expiresAt,
          })),
        },
        xero: {
          accounts: (await listXeroOAuthAccounts()).map((a) => ({
            accountId: a.accountId,
            email: a.email,
            scopes: a.scopes,
            expiresAt: a.expiresAt,
            tenantId: a.tenantId,
            tenantName: a.tenantName,
            missingScopes: xeroBundleMissingScopes(a.scopes),
            missingCoreScopes: xeroBundleMissingCoreScopes(a.scopes),
            missingExtendedScopes: xeroBundleMissingPhase3Scopes(a.scopes),
          })),
        },
        slack: {
          accounts: (await listSlackOAuthAccounts()).map((a) => ({
            accountId: a.accountId,
            email: a.email,
            scopes: a.scopes,
            expiresAt: a.expiresAt,
            teamId: a.teamId,
            teamName: a.teamName,
            missingScopes: missingSlackScopes(a.scopes),
          })),
        },
        linear: {
          accounts: (await listLinearOAuthAccounts()).map((a) => ({
            accountId: a.accountId,
            email: a.email,
            scopes: a.scopes,
            expiresAt: a.expiresAt,
            organizationName: a.organizationName,
          })),
        },
        notion: {
          accounts: (await listNotionOAuthAccounts()).map((a) => ({
            accountId: a.accountId,
            email: a.email,
            scopes: a.scopes,
            expiresAt: a.expiresAt,
            workspaceId: a.workspaceId,
            workspaceName: a.workspaceName,
          })),
        },
        connections,
      });
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
    }
  });

  router.get("/api/integrations/google/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const servicesRaw = req.query["services"];
    const services =
      typeof servicesRaw === "string"
        ? servicesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    pendingHostedOAuth.set(state, {
      exp: Date.now() + 10 * 60_000,
      provider: "google",
      mode,
      services,
    });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const extra: Record<string, string> = {};
    if (services?.length) extra.services = services.join(",");
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "google",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  router.get("/oauth/google/callback", async (req, res) => {
    prunePendingGoogleConnect();
    const state = String(req.query["state"] ?? "");
    const pending = pendingGoogleConnect.get(state);
    const code = String(req.query["code"] ?? "");
    const err = req.query["error"];

    if (err) {
      res.status(400).send(vireonCallbackHtml("Google sign-in failed", escapeHtml(String(err))));
      return;
    }
    if (!pending || !code) {
      res.status(400).send(vireonCallbackHtml("Invalid request", "Missing or expired OAuth state."));
      return;
    }
    pendingGoogleConnect.delete(state);

    try {
      const presets = resolveGoogleServices(pending.services);
      const scopes = scopesForGoogleServices(
        presets.length > 0 ? presets : resolveGoogleServices(undefined),
        pending.mode
      );
      const bundle = await exchangeGoogleCode({ code, redirectUri: pending.redirectUri, scopes });
      try {
        const bridge = active();
        if (!bridge.harness.getIsRunning()) {
          const attach = await connectGoogleWorkspaceFromServer(bridge.harness.registry, {
            services: pending.services,
            mode: pending.mode,
          });
          if (attach.ok) {
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
          }
        }
      } catch {
        /* attach can be retried from Integrations → Attach MCP tools */
      }
      res.send(
        vireonCallbackSuccessRedirect(bundle.email ?? bundle.accountId, "google_workspace").replace(
          "vireon=connected",
          "google=connected"
        )
      );
    } catch (e) {
      res.status(500).send(
        vireonCallbackHtml("Token exchange failed", escapeHtml(e instanceof Error ? e.message : String(e)))
      );
    }
  });

  router.post("/api/integrations/google/connect", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const body = req.body as { services?: string[]; mode?: "read_write" | "read_only" };
    const result = await connectGoogleWorkspaceFromServer(bridge.harness.registry, {
      services: body.services,
      mode: body.mode ?? "read_write",
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.delete("/api/integrations/google", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectGoogleWorkspaceFromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.get("/api/integrations/github/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    pendingHostedOAuth.set(state, { exp: Date.now() + 10 * 60_000, provider: "github", mode });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "github",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  router.post("/api/integrations/github/connect", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const body = req.body as { mode?: "read_write" | "read_only" };
    const result = await connectGithubFromServer(bridge.harness.registry, {
      readOnly: body.mode === "read_only",
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output, toolCount: result.toolCount ?? 0 });
  });

  router.delete("/api/integrations/github", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectGithubFromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.get("/api/integrations/microsoft/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const servicesRaw = req.query["services"];
    const services =
      typeof servicesRaw === "string"
        ? servicesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    pendingHostedOAuth.set(state, {
      exp: Date.now() + 10 * 60_000,
      provider: "microsoft",
      mode,
      services,
    });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const extra: Record<string, string> = {};
    if (services?.length) extra.services = services.join(",");
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "microsoft",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  router.post("/api/integrations/microsoft/connect", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const body = req.body as { services?: string[]; mode?: "read_write" | "read_only" };
    const result = await connectMicrosoft365FromServer(bridge.harness.registry, {
      services: body.services,
      mode: body.mode ?? "read_write",
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.delete("/api/integrations/microsoft", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectMicrosoft365FromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.get("/api/integrations/xero/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    const extended = req.query["extended"] === "1";
    pendingHostedOAuth.set(state, { exp: Date.now() + 10 * 60_000, provider: "xero", mode });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "xero",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
      extra: extended ? { extended: "1" } : undefined,
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  router.get("/api/integrations/slack/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    pendingHostedOAuth.set(state, { exp: Date.now() + 10 * 60_000, provider: "slack", mode });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "slack",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
      extra: slackHostedConnectExtra(mode),
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  router.get("/api/integrations/linear/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    pendingHostedOAuth.set(state, { exp: Date.now() + 10 * 60_000, provider: "linear", mode });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "linear",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  router.get("/api/integrations/notion/begin", (req, res) => {
    prunePendingHostedOAuth();
    const state = randomBytes(16).toString("hex");
    const mode = req.query["mode"] === "read_only" ? "read_only" : "read_write";
    pendingHostedOAuth.set(state, { exp: Date.now() + 10 * 60_000, provider: "notion", mode });
    const harnessRedirectUri = hostedOAuthHandoffPath(WEB_PORT);
    const site = defaultVireonSiteOrigin();
    const connectUrl = buildHostedIntegrationConnectUrl({
      provider: "notion",
      harnessRedirectUri,
      harnessState: state,
      siteOrigin: site,
      mode,
    });
    res.json({ connectUrl, authUrl: connectUrl, state });
  });

  type IntegrationHandoffBundle = {
    provider?: string;
    accountId?: string;
    email?: string;
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
    metadata?: Record<string, unknown>;
  };

  const wantsIntegrationHandoffHtml = (req: import("express").Request): boolean => {
    const ct = req.get("Content-Type") ?? "";
    const payload = (req.body as { payload?: string } | undefined)?.payload;
    if (typeof payload === "string") {
      return isHostedOAuthFormHandoffContent(ct, `payload=${payload}`);
    }
    return isHostedOAuthFormHandoffContent(ct, "");
  };

  const parseIntegrationHandoffBody = (
    req: import("express").Request
  ): { state?: string; provider?: string; bundle?: IntegrationHandoffBundle } => {
    const body = req.body as {
      payload?: string;
      state?: string;
      provider?: string;
      bundle?: IntegrationHandoffBundle;
    };
    if (typeof body?.payload === "string" && body.payload.trim()) {
      return parseHostedOAuthHandoffHttpBody(
        `payload=${body.payload.trim()}`,
        req.get("Content-Type") ?? "application/x-www-form-urlencoded"
      );
    }
    if (body?.state || body?.bundle) return body;
    return body ?? {};
  };

  const integrationHandoffSuccessHtml = (provider: string) =>
    vireonCallbackHtml(
      `${escapeHtml(provider)} connected`,
      `<strong style="color:#6ee7b7">${escapeHtml(provider)} connected.</strong> Close this tab and return to Liminal Integrations.`
    );

  const respondIntegrationHandoffError = (
    req: import("express").Request,
    res: import("express").Response,
    status: number,
    message: string
  ) => {
    if (wantsIntegrationHandoffHtml(req)) {
      res.status(status).type("html").send(vireonCallbackHtml("Connection failed", escapeHtml(message)));
      return;
    }
    res.status(status).json({ error: message });
  };

  router.post("/api/integrations/oauth/handoff", async (req, res) => {
    prunePendingHostedOAuth();
    const body = parseIntegrationHandoffBody(req);
    const state = body.state?.trim() ?? "";
    const pending = state ? pendingHostedOAuth.get(state) : undefined;
    if (!pending || pending.exp < Date.now()) {
      respondIntegrationHandoffError(req, res, 403, "Invalid or expired connect session");
      return;
    }
    const provider = body.provider?.trim() || pending.provider;
    if (provider !== pending.provider) {
      respondIntegrationHandoffError(req, res, 400, "Provider mismatch");
      return;
    }
    const b = body.bundle;
    if (!b?.accessToken || !b.refreshToken || !b.accountId) {
      respondIntegrationHandoffError(req, res, 400, "Incomplete OAuth bundle");
      return;
    }
    try {
      await applyHostedOAuthHandoff({
        provider,
        state,
        bundle: {
          provider,
          accountId: b.accountId,
          email: b.email,
          accessToken: b.accessToken,
          refreshToken: b.refreshToken,
          expiresAt: b.expiresAt ?? Date.now() + 3600_000,
          scopes: b.scopes ?? [],
          metadata: b.metadata,
        },
      });
      const pendingServices = pending.services;
      const pendingMode = pending.mode;
      pendingHostedOAuth.delete(state);
      let attachWarning: string | undefined;
      try {
        const bridge = active();
        if (provider === "xero") {
          const xeroResult = await connectXeroFromServer(bridge.harness.registry);
          if (!xeroResult.ok) attachWarning = xeroResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
        if (provider === "google") {
          const googleResult = await connectGoogleWorkspaceFromServer(bridge.harness.registry, {
            services: pendingServices,
            mode: pendingMode,
          });
          if (!googleResult.ok) attachWarning = googleResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
        if (provider === "microsoft") {
          const msResult = await connectMicrosoft365FromServer(bridge.harness.registry, {
            services: pendingServices,
            mode: pendingMode,
          });
          if (!msResult.ok) attachWarning = msResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
        if (provider === "github") {
          const ghResult = await connectGithubFromServer(bridge.harness.registry, {
            readOnly: pendingMode === "read_only",
          });
          if (!ghResult.ok) attachWarning = ghResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
        if (provider === "slack") {
          const slackResult = await connectSlackFromServer(bridge.harness.registry);
          if (!slackResult.ok) attachWarning = slackResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
        if (provider === "linear") {
          const linearResult = await connectLinearFromServer(bridge.harness.registry);
          if (!linearResult.ok) attachWarning = linearResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
        if (provider === "notion") {
          const notionResult = await connectNotionFromServer(bridge.harness.registry);
          if (!notionResult.ok) attachWarning = notionResult.error;
          else
            bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
        }
      } catch (e) {
        attachWarning = e instanceof Error ? e.message : String(e);
      }
      if (attachWarning && wantsIntegrationHandoffHtml(req)) {
        res
          .status(200)
          .type("html")
          .send(
            integrationHandoffSuccessHtml(provider).replace(
              "Close this tab",
              `Signed in, but agent tools failed to attach: ${escapeHtml(attachWarning)}. Close this tab`
            )
          );
        return;
      }
      if (attachWarning) {
        respondIntegrationHandoffError(req, res, 500, attachWarning);
        return;
      }
      if (wantsIntegrationHandoffHtml(req)) {
        res.status(200).type("html").send(integrationHandoffSuccessHtml(provider));
        return;
      }
      res.json({ ok: true, provider });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      respondIntegrationHandoffError(req, res, 400, message);
    }
  });

  router.delete("/api/integrations/xero", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectXeroFromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.delete("/api/integrations/slack", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectSlackFromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.delete("/api/integrations/linear", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectLinearFromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.delete("/api/integrations/notion", async (req, res) => {
    const bridge = active();
    const revoke = req.query["revoke"] === "1" || req.query["revoke"] === "true";
    const result = await disconnectNotionFromServer(bridge.harness.registry, revoke);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.post("/api/integrations/mcp", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const body = req.body as {
      name?: string;
      url?: string;
      read_only?: boolean;
      auth?: unknown;
    };
    const name = String(body.name ?? "").trim();
    const url = String(body.url ?? "").trim();
    if (!name || !url) {
      res.status(400).json({ error: "name and url are required" });
      return;
    }
    const result = await attachCustomMcpFromServer(bridge.harness.registry, {
      name,
      url,
      readOnly: body.read_only === true,
      auth: parseAuthBody(body.auth),
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output, toolCount: result.toolNames?.length ?? 0 });
  });

  router.delete("/api/integrations/mcp/:name", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const name = String(req.params["name"] ?? "").trim();
    const result = await detachCustomMcpFromServer(bridge.harness.registry, name);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
  });

  router.post("/api/integrations/openapi", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const body = req.body as {
      name?: string;
      specUrl?: string;
      baseUrl?: string;
      autoApproveReads?: boolean;
      auth?: unknown;
    };
    const name = String(body.name ?? "").trim();
    const specUrl = String(body.specUrl ?? "").trim();
    if (!name || !specUrl) {
      res.status(400).json({ error: "name and specUrl are required" });
      return;
    }
    const result = await connectOpenApiFromServer(bridge.harness.registry, {
      name,
      specUrl,
      baseUrl: typeof body.baseUrl === "string" ? body.baseUrl.trim() : undefined,
      auth: parseAuthBody(body.auth),
      autoApproveReads: body.autoApproveReads !== false,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output, toolCount: result.toolNames?.length ?? 0 });
  });

  router.delete("/api/integrations/openapi/:name", async (req, res) => {
    const bridge = active();
    if (bridge.harness.getIsRunning()) {
      res.status(409).json({ error: "Agent is busy; finish the current turn first." });
      return;
    }
    const name = String(req.params["name"] ?? "").trim();
    const result = await disconnectOpenApiFromServer(bridge.harness.registry, name);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    bridge.harness.getContext().refreshProtocolDynamic(bridge.harness.registry.getActiveToolNames());
    res.json({ ok: true, output: result.output });
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
      const pm =
        typeof body.provider.model === "string" ? body.provider.model.trim().slice(0, 200) : "";
      const pb =
        typeof body.provider.baseURL === "string" ? body.provider.baseURL.trim().slice(0, 500) : "";
      const prov: { model?: string; baseURL?: string; inferenceMode?: "byok" | "managed" | "auto" } =
        {};
      if (pm.length > 0) prov.model = pm;
      if (pb.length > 0) prov.baseURL = pb;
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
      sse.clearHistory(bridge.chatId);
      try {
        await bridge.resetPersonaBootstrapForSession();
        res.json({
          ok: true,
          mode: "hard",
          personaBootstrapPending: bridge.isAwaitingPersonaBootstrap,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : "Hard reset failed.";
        res.status(500).json({ error: message });
        return;
      }
      if (!bridge.isAwaitingPersonaBootstrap) {
        void bridge.initializeSessionAfterReset().catch((err) => {
          sse.send(
            "error",
            {
              message: err instanceof Error ? err.message : "Session greeting failed after reset.",
            },
            bridge.chatId
          );
        });
      }
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
      const replayHistory = req.query["replayHistory"] === "1";
      const hasLastEventId = Boolean(req.header("last-event-id") ?? req.query["lastEventId"]);
      if (
        (!replayHistory || sse.historyLength(chatId) === 0) &&
        !hasLastEventId
      ) {
        void bridge.replayPersistedTranscript({ uiOnly: true });
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

  router.get("/api/chats/:id/transcript", async (req, res) => {
    try {
      const meta = await readChatMetadata(req.params.id);
      if (!meta) {
        res.status(404).json({ error: "chat not found" });
        return;
      }
      const entries = await loadChatTranscriptFromSessionLog(req.params.id);
      res.json({ chatId: req.params.id, entries });
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
      const result = await handleAudioUpload(
        {
          chatId: bridge.chatId,
          getRuntimePreferences: () => bridge.harness.getRuntimePreferences(),
        },
        req.body as Parameters<typeof handleAudioUpload>[1]
      );
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/api/transcribe", async (req, res) => {
    try {
      const bridge = active();
      const result = await handleTranscribe(
        {
          chatId: bridge.chatId,
          getRuntimePreferences: () => bridge.harness.getRuntimePreferences(),
        },
        req.body as Parameters<typeof handleTranscribe>[1]
      );
      if (result.ok && typeof result.body.durationSec === "number") {
        sse.send(
          "transcription",
          {
            chatId: bridge.chatId,
            attachmentId: String(result.body.attachmentId ?? ""),
            durationSec: result.body.durationSec,
            costUsd: result.body.costUsd,
            model: result.body.model,
            language: result.body.language,
            at: Date.now(),
          },
          bridge.chatId
        );
      }
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.post("/api/tts", async (req, res) => {
    try {
      const bridge = active();
      const result = await handleTtsPost(
        {
          chatId: bridge.chatId,
          getRuntimePreferences: () => bridge.harness.getRuntimePreferences(),
        },
        req.body as Parameters<typeof handleTtsPost>[1]
      );
      res.status(result.status).json(result.body);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.get("/api/tts/clip/:clipId", async (req, res) => {
    try {
      const bridge = active();
      const clip = await readTtsClipBytes(
        {
          chatId: bridge.chatId,
          getRuntimePreferences: () => bridge.harness.getRuntimePreferences(),
        },
        String(req.params.clipId ?? "")
      );
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
