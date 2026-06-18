/**
 * connect_provider / disconnect_provider / list_connectors — curated Google Workspace integration.
 */
import type { AgentEmitter, ToolRegistry, ToolResult } from "@liminal/core";
import {
  getGoogleAccessToken,
  listGoogleOAuthAccounts,
  revokeGoogleAccount,
  resolveGoogleServices,
  scopesForGoogleServices,
  needsGoogleSidecar,
  formatGoogleScopeDiagnostics,
  missingGoogleScopes,
  missingDefaultWorkspaceScopes,
  countOAuthAccountFiles,
  oauthDecryptHint,
  GOOGLE_OFFICIAL_MCP_API_IDS,
  googleCloudMcpApiLibraryUrl,
  googleProjectIdFromClientId,
  type GoogleServiceId,
  type GoogleServicePreset,
  workspaceMcpToolNamesForServices,
  getMicrosoftAccessToken,
  listMicrosoftOAuthAccounts,
  revokeMicrosoftAccount,
  resolveMicrosoftServices,
  scopesForMicrosoftServices,
  needsMicrosoftSidecar,
  formatMicrosoftScopeDiagnostics,
  missingMicrosoftScopes,
  missingDefaultMicrosoftScopes,
  MICROSOFT_GRAPH_CONNECTION,
  pickBestOAuthAccountByEmail,
  resolvePreferredMailProvider,
  formatPreferredMailRouteLine,
  formatConnectedMailboxesLine,
  listConnectedMailOAuthAccounts,
  listXeroOAuthAccounts,
  revokeXeroAccount,
  xeroBundleMissingScopes,
  listGithubOAuthAccounts,
  listSlackOAuthAccounts,
  revokeSlackAccount,
  listLinearOAuthAccounts,
  revokeLinearAccount,
  listNotionOAuthAccounts,
  revokeNotionAccount,
  listYoutubeOAuthAccounts,
  revokeYoutubeAccount,
  enrichYoutubeBundleChannel,
  missingYoutubeScopes,
  youtubeConnectOptionsFromMetadata,
  getAzureAccessToken,
  listAzureOAuthAccounts,
  revokeAzureAccount,
  resolveAzureServices,
  needsAzureSidecar,
  formatAzureScopeDiagnostics,
  missingAzureScopes,
  AZURE_MCP_CONNECTION,
  tryAzCliArmAccessToken,
  missingSlackScopes,
  slackOAuthClientConfig,
  SLACK_DEFAULT_MODE,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  deleteConnection,
  googleOAuthAuthScheme,
  microsoftOAuthAuthScheme,
  listConnections,
  listConnectionsByParent,
  listGoogleWorkspaceConnections,
  listMicrosoft365Connections,
  listAzureConnections,
  type McpConnectionRecord,
} from "../external_api/api_connections_store.js";
import { attachMcpConnection, unregisterMcpConnection } from "../external_api/mcp_attach.js";
import { gmailSendRestEnabled } from "../google/google_gmail_send.js";
import { calendarRestEnabled } from "../google/google_calendar_rest.js";
import { analyticsRestEnabled } from "../google/google_analytics_rest.js";
import { searchConsoleRestEnabled } from "../google/google_search_console_rest.js";
import { officeRestEnabled } from "../google/google_office_rest.js";
import { ensureGoogleSidecarRunning, releaseGoogleSidecar, stopGoogleSidecar, getGoogleSidecarStatus } from "../google/google_sidecar.js";
import {
  ensureMicrosoftSidecarRunning,
  releaseMicrosoftSidecar,
  stopMicrosoftSidecar,
  getMicrosoftSidecarStatus,
} from "../microsoft/microsoft_sidecar.js";
import {
  ensureAzureSidecarRunning,
  releaseAzureSidecar,
  stopAzureSidecar,
  getAzureSidecarStatus,
} from "../azure/azure_sidecar.js";
import { azureRestEnabled } from "../azure/azure_rest.js";
import { outlookRestEnabled } from "../microsoft/outlook_send.js";
import { microsoftCalendarRestEnabled } from "../microsoft/microsoft_calendar_rest.js";
import { onedriveRestEnabled } from "../microsoft/onedrive_rest.js";
import { excelRestEnabled } from "../microsoft/excel_rest.js";
import { microsoftOfficeRestEnabled } from "../microsoft/microsoft_office_rest.js";
import { graphSearchRestEnabled } from "../microsoft/graph_search_rest.js";
import { xeroRestEnabled } from "../xero/xero_rest.js";
import { slackRestEnabled } from "../slack/slack_rest.js";
import { linearRestEnabled } from "../linear/linear_rest.js";
import { notionRestEnabled } from "../notion/notion_rest.js";
import {
  connectGithubMcp,
  disconnectGithubMcp,
  githubMcpEnabled,
  githubTokenPresent,
  GITHUB_PARENT_PROVIDER,
} from "../github/github_connect.js";
import {
  type ConnectProviderId,
  integrationNotConnectedError,
  isConnectProviderOAuthReady,
  startConnectProviderOAuth,
} from "./integration_oauth_start.js";
import { buildIntegrationLiveProbeLines } from "../../shared/connector_live_probes.js";
import { enrichGoogleMcpProbeError } from "../external_api/mcp_attach.js";

const PARENT_PROVIDER = "google_workspace";
const MICROSOFT_PARENT_PROVIDER = "microsoft_365";
const AZURE_PARENT_PROVIDER = "azure";

function integrationLazyLoadHint(registry: ToolRegistry, family?: string): string {
  if (!registry.isLazyToolLoading()) return "";
  const id = family ?? "google_workspace|microsoft_365|azure|github|slack|linear|notion|xero";
  return (
    `\nLazy loading: activate_tool_family({ family: "${id}" }) for this provider's tools (not the whole connectors bundle).`
  );
}

function uniqueConnectionNames(presets: GoogleServicePreset[]): Map<string, GoogleServicePreset[]> {
  const byConn = new Map<string, GoogleServicePreset[]>();
  for (const p of presets) {
    const list = byConn.get(p.connectionName) ?? [];
    list.push(p);
    byConn.set(p.connectionName, list);
  }
  return byConn;
}

async function ensureGoogleOAuth(accountHint?: string): Promise<{ accountId: string; email?: string } | null> {
  const token = await getGoogleAccessToken(accountHint);
  if (token) {
    const accounts = await listGoogleOAuthAccounts();
    const match = accountHint
      ? accounts.find((a) => a.accountId === accountHint || a.email === accountHint)
      : pickBestOAuthAccountByEmail(accounts) ?? accounts[0];
    if (match) return { accountId: match.accountId, email: match.email };
  }
  return null;
}

async function ensureMicrosoftOAuth(
  accountHint?: string
): Promise<{ accountId: string; email?: string } | null> {
  const token = await getMicrosoftAccessToken(accountHint);
  if (token) {
    const accounts = await listMicrosoftOAuthAccounts();
    const match = accountHint
      ? accounts.find((a) => a.accountId === accountHint || a.email === accountHint)
      : accounts[0];
    if (match) return { accountId: match.accountId, email: match.email };
  }
  return null;
}

async function ensureAzureOAuth(
  accountHint?: string
): Promise<{ accountId: string; email?: string } | null> {
  const token = await getAzureAccessToken(accountHint);
  if (token) {
    const accounts = await listAzureOAuthAccounts();
    const match = accountHint
      ? accounts.find((a) => a.accountId === accountHint || a.email === accountHint)
      : accounts[0];
    if (match) return { accountId: match.accountId, email: match.email };
  }
  return null;
}

async function connectAzureHandler(
  registry: ToolRegistry,
  args: Record<string, unknown>,
  emit?: (text: string) => void
): Promise<ToolResult> {
  const oauthPrep = await prepareProviderOAuth("azure", args, emit);
  if (oauthPrep) return oauthPrep;

  const mode = args["mode"] === "read_only" ? "read_only" : "read_write";
  const serviceIds = Array.isArray(args["services"])
    ? (args["services"] as unknown[]).map((s) => String(s))
    : undefined;
  const accountHint = typeof args["account_hint"] === "string" ? args["account_hint"].trim() : undefined;

  const presets = resolveAzureServices(serviceIds);
  if (presets.length === 0) {
    return { ok: false, error: "no valid services in services[]" };
  }

  const oauth = await ensureAzureOAuth(accountHint);
  const cliToken = await tryAzCliArmAccessToken();
  if (!oauth && !cliToken) {
    return { ok: false, error: integrationNotConnectedError("azure") };
  }

  const accounts = oauth ? await listAzureOAuthAccounts() : [];
  const match = oauth ? accounts.find((a) => a.accountId === oauth.accountId) : undefined;
  const granted = match?.scopes ?? [];
  const readOnly = mode === "read_only";
  const attachErrors: string[] = [];
  let totalTools = 0;
  const attached: string[] = [];

  if (needsAzureSidecar(presets)) {
    const sidecarMiss = oauth ? missingAzureScopes(granted, presets, mode) : [];
    if (sidecarMiss.length > 0) {
      attachErrors.push(formatAzureScopeDiagnostics(granted, presets, mode));
    } else {
      const sidecar = await ensureAzureSidecarRunning({ presets });
      if (!sidecar.ok) {
        attachErrors.push(
          `azure sidecar: ${sidecar.error}. Requires Node.js, npx, and .NET 8+; run \`az login\` for MCP credentials.`
        );
      } else {
        try {
          const { registered } = await attachMcpConnection(registry, {
            name: AZURE_MCP_CONNECTION,
            url: sidecar.url,
            auth: { kind: "none" },
            readOnly,
            providerId: "azure_mcp",
            parentProvider: AZURE_PARENT_PROVIDER,
            services: presets.map((p) => p.id),
            oauthAccountId: oauth?.accountId,
            sidecarManaged: true,
          });
          attached.push(AZURE_MCP_CONNECTION);
          totalTools += registered.length;
        } catch (e) {
          attachErrors.push(`azure: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  const identity = oauth?.email ?? oauth?.accountId ?? (cliToken ? "az cli" : "unknown");
  const restNote = `\nREST tools: ${azureRestEnabled() ? "on" : "off (set AGENT_AZURE_REST=1)"}`;

  if (attached.length === 0) {
    if (oauth || cliToken) {
      const partial = attachErrors.length > 0 ? `\n\nMCP skipped:\n${attachErrors.join("\n")}` : "";
      return {
        ok: true,
        output:
          `Connected azure as ${identity} (${mode}, REST only).\n` +
          `Services: ${presets.map((p) => p.id).join(", ")}` +
          restNote +
          integrationLazyLoadHint(registry, "azure") +
          partial,
      };
    }
    return {
      ok: false,
      error:
        (attachErrors.length > 0 ? attachErrors.join("\n\n") : "no connections attached") +
        "\n\nAdd Azure Service Management user_impersonation to your Entra app or run `az login`.",
    };
  }

  const partial = attachErrors.length > 0 ? `\n\nSkipped / failed:\n${attachErrors.join("\n")}` : "";
  return {
    ok: true,
    output:
      `Connected azure as ${identity} (${mode}).\n` +
      `Connections: ${attached.join(", ")}\n` +
      `Registered MCP tools: ${totalTools}\n` +
      `Services: ${presets.map((p) => p.id).join(", ")}` +
      restNote +
      integrationLazyLoadHint(registry, "azure") +
      partial,
  };
}

async function prepareProviderOAuth(
  provider: ConnectProviderId,
  args: Record<string, unknown>,
  emit?: (text: string) => void
): Promise<ToolResult | null> {
  if (args["start_oauth"] !== true) return null;
  const mode = args["mode"] === "read_only" ? "read_only" : "read_write";
  const monetary = args["monetary"] === true;
  const forceReconnect = args["force_reconnect"] === true;
  const services = Array.isArray(args["services"])
    ? (args["services"] as unknown[]).map((s) => String(s))
    : undefined;

  if (!forceReconnect) {
    if (provider === "youtube") {
      const accounts = await listYoutubeOAuthAccounts();
      const account = accounts[0];
      if (account) {
        const opts = youtubeConnectOptionsFromMetadata(
          { mode: account.connectMode ?? mode, monetary: account.monetaryRequested },
          mode
        );
        if (missingYoutubeScopes(account.scopes, opts).length === 0) {
          emit?.("youtube: OAuth already has required scopes — continuing…");
          return null;
        }
      }
    } else if (await isConnectProviderOAuthReady(provider)) {
      emit?.(`${provider}: OAuth already on disk — continuing…`);
      return null;
    }
  }

  const started = await startConnectProviderOAuth(provider, {
    mode,
    services,
    monetary: provider === "youtube" ? args["monetary"] !== false : undefined,
    onStatus: (m) => emit?.(m),
  });
  if (!started.ok) return { ok: false, error: started.error };
  emit?.(`Signed in as ${started.label}.`);
  return null;
}

async function connectMicrosoft365Handler(
  registry: ToolRegistry,
  args: Record<string, unknown>,
  emit?: (text: string) => void
): Promise<ToolResult> {
  const oauthPrep = await prepareProviderOAuth("microsoft_365", args, emit);
  if (oauthPrep) return oauthPrep;

  const mode = args["mode"] === "read_only" ? "read_only" : "read_write";
  const serviceIds = Array.isArray(args["services"])
    ? (args["services"] as unknown[]).map((s) => String(s))
    : undefined;
  const accountHint = typeof args["account_hint"] === "string" ? args["account_hint"].trim() : undefined;

  const presets = resolveMicrosoftServices(serviceIds);
  if (presets.length === 0) {
    return { ok: false, error: "no valid services in services[]" };
  }

  const oauth = await ensureMicrosoftOAuth(accountHint);
  if (!oauth) {
    return { ok: false, error: integrationNotConnectedError("microsoft_365") };
  }

  const accounts = await listMicrosoftOAuthAccounts();
  const match = accounts.find((a) => a.accountId === oauth.accountId);
  const granted = match?.scopes ?? [];
  const scopes = scopesForMicrosoftServices(presets, mode);
  const auth = microsoftOAuthAuthScheme(oauth.accountId, scopes);
  const readOnly = mode === "read_only";
  const attachErrors: string[] = [];
  let totalTools = 0;
  const attached: string[] = [];

  if (needsMicrosoftSidecar(presets)) {
    const sidecarPresets = presets.filter((p) => p.backend === "microsoft_sidecar");
    const sidecarMiss = missingMicrosoftScopes(granted, sidecarPresets);
    if (sidecarMiss.length > 0) {
      attachErrors.push(formatMicrosoftScopeDiagnostics(granted, sidecarPresets));
    } else {
      const accessToken = await getMicrosoftAccessToken(oauth.accountId);
      const sidecar = await ensureMicrosoftSidecarRunning(accessToken ?? undefined, { readOnly });
      if (!sidecar.ok) {
        attachErrors.push(
          `microsoft sidecar: ${sidecar.error}. Install Node.js; sidecar runs npx @softeria/ms-365-mcp-server --http.`
        );
      } else {
        try {
          const { registered } = await attachMcpConnection(registry, {
            name: MICROSOFT_GRAPH_CONNECTION,
            url: sidecar.url,
            auth,
            readOnly,
            providerId: "microsoft_graph",
            parentProvider: MICROSOFT_PARENT_PROVIDER,
            services: sidecarPresets.map((p) => p.id),
            oauthAccountId: oauth.accountId,
            sidecarManaged: true,
          });
          attached.push(MICROSOFT_GRAPH_CONNECTION);
          totalTools += registered.length;
        } catch (e) {
          attachErrors.push(`microsoft: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
  }

  if (attached.length === 0) {
    return {
      ok: false,
      error:
        (attachErrors.length > 0 ? attachErrors.join("\n\n") : "no connections attached") +
        "\n\nEnsure Microsoft Graph delegated permissions are granted in Azure Portal for the selected services.",
    };
  }

  const partial = attachErrors.length > 0 ? `\n\nSkipped / failed:\n${attachErrors.join("\n")}` : "";
  const restNote =
    `\nREST tools: outlook=${outlookRestEnabled()}, calendar=${microsoftCalendarRestEnabled()}, ` +
    `onedrive=${onedriveRestEnabled()}, excel=${excelRestEnabled()}, search=${graphSearchRestEnabled()}`;

  return {
    ok: true,
    output:
      `Connected microsoft_365 as ${oauth.email ?? oauth.accountId} (${mode}).\n` +
      `Connections: ${attached.join(", ")}\n` +
      `Registered MCP tools: ${totalTools}\n` +
      `Services: ${presets.map((p) => p.id).join(", ")}` +
      restNote +
      integrationLazyLoadHint(registry, "microsoft_365") +
      partial,
  };
}

export function createConnectorTools(registry: ToolRegistry, _emitter: AgentEmitter) {
  const connectProviderTool = defineTool({
    name: "connect_provider",
    description:
      "WHAT: Connect curated providers — Google, Microsoft 365, Azure, Xero, GitHub, Slack, Linear, Notion, or YouTube (hosted OAuth).\n" +
      "WHEN: User asks to work with mail/calendar/files, cloud infra, accounting, repos, Slack, Linear, Notion, or YouTube; or another tool reports not connected.\n" +
      "HOW: Set start_oauth:true to open hosted sign-in in the browser and wait for tokens. GitHub also supports legacy GITHUB_TOKEN in .env.",
    parameters: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["google_workspace", "microsoft_365", "azure", "xero", "github", "slack", "linear", "notion", "youtube"],
          description: "Provider preset id.",
        },
        start_oauth: {
          type: "boolean",
          description:
            "When true and OAuth is missing, opens vireondynamics.com sign-in in the browser and blocks until tokens are saved.",
        },
        services: {
          type: "array",
          items: { type: "string" },
          description:
            "Google: drive, gmail, calendar, … — Microsoft: mail, calendar, onedrive, teams, … — Azure: all, compute, storage, keyvault, … Default: all.",
        },
        mode: {
          type: "string",
          enum: ["read_write", "read_only"],
          description: "read_only skips write MCP tools.",
        },
        account_hint: {
          type: "string",
          description: "Optional Google account email or account id.",
        },
      },
      required: ["provider"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args, emit): Promise<ToolResult> => {
      const provider = String(args["provider"] ?? "").trim();
      if (provider === "github") {
        const oauthPrep = await prepareProviderOAuth("github", args, emit);
        if (oauthPrep) return oauthPrep;
        const result = await connectGithubMcp(registry, {
          readOnly: args["mode"] === "read_only",
        });
        if (!result.ok) return { ok: false, error: result.error };
        return {
          ok: true,
          output: result.output + integrationLazyLoadHint(registry, "github"),
        };
      }
      if (provider === "microsoft_365") {
        return connectMicrosoft365Handler(registry, args, emit);
      }
      if (provider === "azure") {
        return connectAzureHandler(registry, args, emit);
      }
      if (provider === "xero") {
        const oauthPrep = await prepareProviderOAuth("xero", args, emit);
        if (oauthPrep) return oauthPrep;
        const accounts = await listXeroOAuthAccounts();
        if (accounts.length === 0) {
          return { ok: false, error: integrationNotConnectedError("xero") };
        }
        const a = accounts[0]!;
        return {
          ok: true,
          output:
            `Xero connected as ${a.email ?? a.accountId}` +
            (a.tenantName ? ` (${a.tenantName})` : a.tenantId ? ` (tenant ${a.tenantId})` : "") +
            ".\nTools: xero_* family (invoices, bills, contacts, payments, bank, journals, reports) — activate_tool_family({ family: \"xero\" }) if lazy." +
            integrationLazyLoadHint(registry, "xero"),
        };
      }
      if (provider === "slack") {
        const oauthPrep = await prepareProviderOAuth("slack", args, emit);
        if (oauthPrep) return oauthPrep;
        const accounts = await listSlackOAuthAccounts();
        if (accounts.length === 0) {
          return { ok: false, error: integrationNotConnectedError("slack") };
        }
        const a = accounts[0]!;
        return {
          ok: true,
          output:
            `Slack connected as ${a.teamName ?? a.accountId}` +
            ".\nTools: slack_list_channels, slack_get_channel_history, slack_get_thread_replies, slack_search_messages, " +
            "slack_list_users, slack_open_dm, slack_post_message, slack_reply_in_thread, slack_add_reaction, slack_upload_file." +
            integrationLazyLoadHint(registry, "slack"),
        };
      }
      if (provider === "linear") {
        const oauthPrep = await prepareProviderOAuth("linear", args, emit);
        if (oauthPrep) return oauthPrep;
        const accounts = await listLinearOAuthAccounts();
        if (accounts.length === 0) {
          return { ok: false, error: integrationNotConnectedError("linear") };
        }
        const a = accounts[0]!;
        return {
          ok: true,
          output:
            `Linear connected as ${a.email ?? a.organizationName ?? a.accountId}` +
            ".\nTools: full Linear suite (viewer, teams, issues, labels, cycles, projects, search, comments, create/update/assign/archive, sub-issues, attachments)." +
            integrationLazyLoadHint(registry, "linear"),
        };
      }
      if (provider === "notion") {
        const oauthPrep = await prepareProviderOAuth("notion", args, emit);
        if (oauthPrep) return oauthPrep;
        const accounts = await listNotionOAuthAccounts();
        if (accounts.length === 0) {
          return { ok: false, error: integrationNotConnectedError("notion") };
        }
        const a = accounts[0]!;
        return {
          ok: true,
          output:
            `Notion connected as ${a.workspaceName ?? a.email ?? a.accountId}` +
            ".\nTools: notion_search, notion_get_page, notion_list_block_children, notion_get_database, notion_query_database, notion_create_page, notion_update_page, notion_append_blocks." +
            integrationLazyLoadHint(registry, "notion"),
        };
      }
      if (provider === "youtube") {
        const oauthPrep = await prepareProviderOAuth("youtube", args, emit);
        if (oauthPrep) return oauthPrep;
        const accounts = await listYoutubeOAuthAccounts();
        if (accounts.length === 0) {
          return { ok: false, error: integrationNotConnectedError("youtube") };
        }
        const a = accounts[0]!;
        const label = a.channelTitle ?? a.customUrl ?? a.email ?? a.accountId;
        const opts = youtubeConnectOptionsFromMetadata(
          { mode: a.connectMode, monetary: a.monetaryRequested },
          a.connectMode ?? "read_write"
        );
        const missing = missingYoutubeScopes(a.scopes, opts);
        if (missing.length > 0) {
          return {
            ok: false,
            error:
              `YouTube channel ${label} is missing OAuth scopes: ${missing.join(", ")}. ` +
              "Reconnect in Settings → Integrations → YouTube (enable revenue analytics) or " +
              'connect_provider({ provider: "youtube", start_oauth: true, force_reconnect: true }).',
          };
        }
        return {
          ok: true,
          output:
            `YouTube channel connected: ${label}` +
            (a.channelId ? ` (${a.channelId})` : "") +
            ".\nTools: youtube_rest_get_video, youtube_analytics_report (preferred), youtube_rest_list_videos, youtube_rest_update_video." +
            integrationLazyLoadHint(registry, "youtube"),
        };
      }
      if (provider !== "google_workspace") {
        return { ok: false, error: `unsupported provider '${provider}'` };
      }

      const oauthPrep = await prepareProviderOAuth("google_workspace", args, emit);
      if (oauthPrep) return oauthPrep;

      const mode = args["mode"] === "read_only" ? "read_only" : "read_write";
      const serviceIds = Array.isArray(args["services"])
        ? (args["services"] as unknown[]).map((s) => String(s))
        : undefined;
      const accountHint = typeof args["account_hint"] === "string" ? args["account_hint"].trim() : undefined;

      const presets = resolveGoogleServices(serviceIds);
      if (presets.length === 0) {
        return { ok: false, error: "no valid services in services[]" };
      }

      const oauth = await ensureGoogleOAuth(accountHint);
      if (!oauth) {
        return { ok: false, error: integrationNotConnectedError("google_workspace", "Google Workspace") };
      }

      const accounts = await listGoogleOAuthAccounts();
      const match = accounts.find((a) => a.accountId === oauth.accountId);
      const granted = match?.scopes ?? [];
      const scopes = scopesForGoogleServices(presets, mode);
      const auth = googleOAuthAuthScheme(oauth.accountId, scopes);
      const readOnly = mode === "read_only";

      const byConn = uniqueConnectionNames(presets);
      const attached: string[] = [];
      const attachErrors: string[] = [];
      let totalTools = 0;

      if (needsGoogleSidecar(presets)) {
        const sidecarServices = presets.filter((p) => p.backend === "google_sidecar").map((p) => p.id);
        const sidecarMiss = missingGoogleScopes(granted, presets.filter((p) => p.backend === "google_sidecar"));
        if (sidecarMiss.length > 0) {
          attachErrors.push(
            `google_ext: ${formatGoogleScopeDiagnostics(granted, presets.filter((p) => p.backend === "google_sidecar"))}`
          );
        } else {
          const accessToken = await getGoogleAccessToken(oauth.accountId);
          const sidecar = await ensureGoogleSidecarRunning(accessToken ?? undefined, {
            tools: workspaceMcpToolNamesForServices(sidecarServices),
            readOnly,
          });
          if (!sidecar.ok) {
            attachErrors.push(
              `google_ext sidecar: ${sidecar.error}. Install uv (https://docs.astral.sh/uv/) for Docs/Sheets.`
            );
          } else {
            try {
              const { registered } = await attachMcpConnection(registry, {
                name: "google_ext",
                url: sidecar.url,
                auth,
                readOnly,
                providerId: "google_ext",
                parentProvider: PARENT_PROVIDER,
                services: sidecarServices,
                oauthAccountId: oauth.accountId,
                sidecarManaged: true,
              });
              attached.push("google_ext");
              totalTools += registered.length;
            } catch (e) {
              attachErrors.push(`google_ext: ${e instanceof Error ? e.message : String(e)}`);
            }
          }
        }
      }

      const restAttached: string[] = [];
      for (const preset of presets.filter((p) => p.backend === "google_rest")) {
        const miss = missingGoogleScopes(granted, [preset]);
        if (miss.length > 0) {
          attachErrors.push(`${preset.connectionName}: ${formatGoogleScopeDiagnostics(granted, [preset])}`);
        } else {
          restAttached.push(preset.id);
          attached.push(preset.connectionName);
        }
      }

      for (const [connName, group] of byConn) {
        if (connName === "google_ext") continue;
        const preset = group[0]!;
        if (preset.backend === "google_rest" || !preset.mcpUrl) continue;
        const miss = missingGoogleScopes(granted, group);
        if (miss.length > 0) {
          attachErrors.push(`${connName}: ${formatGoogleScopeDiagnostics(granted, group)}`);
          continue;
        }
        try {
          const { registered } = await attachMcpConnection(registry, {
            name: connName,
            url: preset.mcpUrl,
            auth,
            readOnly,
            providerId: preset.id,
            parentProvider: PARENT_PROVIDER,
            services: group.map((g) => g.id),
            oauthAccountId: oauth.accountId,
          });
          attached.push(connName);
          totalTools += registered.length;
        } catch (e) {
          const raw = e instanceof Error ? e.message : String(e);
          attachErrors.push(`${connName}: ${enrichGoogleMcpProbeError(preset.mcpUrl ?? "", raw)}`);
        }
      }

      if (attached.length === 0) {
        return {
          ok: false,
          error:
            (attachErrors.length > 0 ? attachErrors.join("\n\n") : "no connections attached") +
            "\n\nIf Calendar MCP fails with permission errors, enroll the Cloud project in the Workspace Developer Preview: https://developers.google.com/workspace/preview",
        };
      }

      const partial = attachErrors.length > 0 ? `\n\nSkipped / failed:\n${attachErrors.join("\n")}` : "";
      const restNote =
        restAttached.length > 0
          ? `\nREST services (tools register when AGENT_GOOGLE_*_REST=1): ${restAttached.join(", ")} — analytics_rest_*, search_console_rest_*`
          : "";

      return {
        ok: true,
        output:
          `Connected google_workspace as ${oauth.email ?? oauth.accountId} (${mode}).\n` +
          `Connections: ${attached.join(", ")}\n` +
          `Registered MCP tools: ${totalTools}\n` +
          `Services attached: ${attached.join(", ")}` +
          restNote +
          integrationLazyLoadHint(registry, "google_workspace") +
          partial,
      };
    },
  });

  const disconnectProviderTool = defineTool({
    name: "disconnect_provider",
    description: "Disconnect a curated provider — removes MCP tools (Google: optional OAuth revoke).",
    parameters: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["google_workspace", "microsoft_365", "azure", "xero", "github", "slack", "linear", "notion", "youtube"],
        },
        revoke_oauth: {
          type: "boolean",
          description: "Delete local OAuth tokens when true (default false).",
        },
      },
      required: ["provider"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const provider = String(args["provider"] ?? "").trim();
      if (provider === "github") {
        const result = await disconnectGithubMcp(registry, args["revoke_oauth"] === true);
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: result.output };
      }
      if (provider === "xero") {
        if (args["revoke_oauth"] === true) {
          const accounts = await listXeroOAuthAccounts();
          for (const a of accounts) {
            await revokeXeroAccount(a.accountId);
          }
        }
        return {
          ok: true,
          output: `Disconnected xero${args["revoke_oauth"] === true ? " (OAuth tokens revoked)" : ""}.`,
        };
      }
      if (provider === "slack") {
        if (args["revoke_oauth"] === true) {
          const accounts = await listSlackOAuthAccounts();
          for (const a of accounts) {
            await revokeSlackAccount(a.accountId);
          }
        }
        return {
          ok: true,
          output: `Disconnected slack${args["revoke_oauth"] === true ? " (OAuth tokens revoked)" : ""}.`,
        };
      }
      if (provider === "linear") {
        if (args["revoke_oauth"] === true) {
          const accounts = await listLinearOAuthAccounts();
          for (const a of accounts) {
            await revokeLinearAccount(a.accountId);
          }
        }
        return {
          ok: true,
          output: `Disconnected linear${args["revoke_oauth"] === true ? " (OAuth tokens revoked)" : ""}.`,
        };
      }
      if (provider === "notion") {
        if (args["revoke_oauth"] === true) {
          const accounts = await listNotionOAuthAccounts();
          for (const a of accounts) {
            await revokeNotionAccount(a.accountId);
          }
        }
        return {
          ok: true,
          output: `Disconnected notion${args["revoke_oauth"] === true ? " (OAuth tokens revoked)" : ""}.`,
        };
      }
      if (provider === "youtube") {
        if (args["revoke_oauth"] === true) {
          const accounts = await listYoutubeOAuthAccounts();
          for (const a of accounts) {
            await revokeYoutubeAccount(a.accountId);
          }
        }
        return {
          ok: true,
          output: `Disconnected youtube${args["revoke_oauth"] === true ? " (OAuth tokens revoked)" : ""}.`,
        };
      }
      if (provider === "microsoft_365") {
        return disconnectMicrosoft365Mcp(registry, args["revoke_oauth"] === true);
      }
      if (provider === "azure") {
        return disconnectAzureMcp(registry, args["revoke_oauth"] === true);
      }
      if (provider !== "google_workspace") {
        return { ok: false, error: `unsupported provider '${provider}'` };
      }

      return disconnectGoogleWorkspaceMcp(registry, args["revoke_oauth"] === true);
    },
  });

  const listConnectorsTool = defineTool({
    name: "list_connectors",
    description: "List curated provider connections (Google OAuth accounts, MCP connections, sidecar status).",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 10_000,
    handler: async (): Promise<ToolResult> => {
      const lines: string[] = ["## Connectors", ""];
      const mailRoute = await resolvePreferredMailProvider();
      lines.push(formatPreferredMailRouteLine(mailRoute));
      const connectedMail = await listConnectedMailOAuthAccounts();
      lines.push(formatConnectedMailboxesLine(connectedMail));
      lines.push(
        "Inbox scan: mail_search_inboxes uses **connected mailboxes only** (mail OAuth scopes; skips unconnected providers and Entra guest admin accounts)."
      );
      lines.push("");
      lines.push(
        `Gmail: hybrid — mail_search_inboxes (all accounts) + mcp_google_gmail_* (single bound account) + gmail_create_draft + gmail_send_message REST: ${
          gmailSendRestEnabled() ? "on" : "off (set AGENT_GOOGLE_GMAIL_SEND=1)"
        }`
      );
      lines.push(
        `Calendar: hybrid — mcp_google_calendar_* (list/get/create/update/delete/respond/suggest) + calendar_rest_* REST: ${
          calendarRestEnabled()
            ? "on (calendars/settings/timezone, events, freebusy, quick add, Meet, ACL, RSVP, recurrence, move/import)"
            : "off (set AGENT_GOOGLE_CALENDAR_REST=1)"
        }`
      );
      lines.push(
        `Docs/Sheets/Slides: hybrid — mcp_google_ext_* (workspace-mcp sidecar) + docs/sheets/slides_rest_* REST: ${
          officeRestEnabled()
            ? "on (docs write_blocks/tables/images, sheets values, export PDF/CSV)"
            : "off (set AGENT_GOOGLE_OFFICE_REST=1)"
        }`
      );
      lines.push(
        `Analytics (GA4): REST-only — analytics_rest_* (accounts, properties, reports, realtime, custom dimensions): ${
          analyticsRestEnabled()
            ? "on — connect OAuth with analytics service; enable Analytics Admin + Data APIs in Cloud Console"
            : "off (set AGENT_GOOGLE_ANALYTICS_REST=1)"
        }`
      );
      lines.push(
        `Search Console: REST-only — search_console_rest_* (sites, search analytics, URL inspection, sitemaps): ${
          searchConsoleRestEnabled()
            ? "on — connect OAuth with search_console service; enable Search Console API in Cloud Console"
            : "off (set AGENT_GOOGLE_SEARCH_CONSOLE_REST=1)"
        }`
      );
      const ghAccounts = await listGithubOAuthAccounts();
      lines.push(
        `GitHub: mcp_github_* via GitHub MCP — ${githubMcpEnabled() ? "enabled" : "off (AGENT_GITHUB_MCP=0)"}, oauth=${
          ghAccounts.length > 0 ? `${ghAccounts.length} account(s)` : "not connected"
        }, env_pat=${githubTokenPresent() ? "set" : "off"}`
      );
      lines.push(
        `Microsoft 365: mcp_microsoft_* sidecar + outlook/calendar/onedrive REST — outlook=${outlookRestEnabled()}, calendar=${microsoftCalendarRestEnabled()}, onedrive=${onedriveRestEnabled()}, office=${microsoftOfficeRestEnabled()}`
      );
      lines.push(
        `Azure: mcp_azure_* (@azure/mcp sidecar) + ARM REST — rest=${azureRestEnabled() ? "on" : "off"}, connect via Settings or connect_provider({ provider: "azure" })`
      );
      lines.push(
        `Xero: REST accounting tools — ${xeroRestEnabled() ? "on" : "off (set AGENT_XERO_REST=0 to disable)"}, connect via Settings → Integrations (hosted OAuth)`
      );
      lines.push(
        `Slack: REST workspace tools — ${slackRestEnabled() ? "on" : "off (set AGENT_SLACK_REST=0 to disable)"}, connect via Settings → Integrations or \`liminal connect slack\``
      );
      lines.push(
        `Linear: REST issue tools — ${linearRestEnabled() ? "on" : "off (set AGENT_LINEAR_REST=0 to disable)"}, connect via Settings → Integrations or \`liminal connect linear\``
      );
      lines.push(
        `Notion: REST workspace tools — ${notionRestEnabled() ? "on" : "off (set AGENT_NOTION_REST=0 to disable)"}, connect via Settings → Integrations or \`liminal connect notion\``
      );
      lines.push("");

      const xeroAccounts = await listXeroOAuthAccounts();
      lines.push("### Xero OAuth");
      if (xeroAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("xero");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("xero")}`);
        } else {
          lines.push("- (not connected — Settings → Integrations → Connect Xero)");
        }
      } else {
        for (const a of xeroAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          const missing = xeroBundleMissingScopes(a.scopes);
          lines.push(
            `- ${a.email ?? a.accountId}${a.tenantName ? ` · ${a.tenantName}` : a.tenantId ? ` · tenant ${a.tenantId}` : ""} (expires ~${exp}, ${a.scopes.length} scopes${missing.length > 0 ? ` — reconnect needed (${missing.length} missing)` : ""})`
          );
        }
      }
      lines.push("");

      const slackAccounts = await listSlackOAuthAccounts();
      lines.push("### Slack OAuth");
      if (slackAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("slack");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("slack")}`);
        } else {
          lines.push("- (not connected — Settings → Integrations → Connect Slack, or `liminal connect slack`)");
        }
      } else {
        for (const a of slackAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          const stale = missingSlackScopes(a.scopes, SLACK_DEFAULT_MODE);
          lines.push(
            `- ${a.teamName ?? a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes` +
              `${stale.length ? `, **stale scopes** — reconnect Slack for: ${stale.join(", ")}` : ""})`
          );
        }
        if (slackAccounts.some((a) => missingSlackScopes(a.scopes, SLACK_DEFAULT_MODE).length > 0)) {
          lines.push(
            "  Reconnect: Settings → Integrations → Slack → Disconnect + Connect, or `connect_provider({ provider: \"slack\", start_oauth: true })`."
          );
        } else {
          lines.push(
            "  If Slack tools return missing_scope anyway, token may predate new tools — still Disconnect + Connect once."
          );
        }
        if (slackOAuthClientConfig()) {
          lines.push(
            "  Direct Slack OAuth available — set SLACK_OAUTH_DIRECT=1 to bypass Vireon hosted connect."
          );
        } else {
          lines.push(
            "  For persistent missing_scope: add SLACK_OAUTH_CLIENT_ID + SLACK_OAUTH_CLIENT_SECRET to .env (see docs/guides/slack.md) or fix Vireon to pass user_scope= to Slack."
          );
        }
      }
      lines.push("");

      const linearAccounts = await listLinearOAuthAccounts();
      lines.push("### Linear OAuth");
      if (linearAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("linear");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("linear")}`);
        } else {
          lines.push("- (not connected — Settings → Integrations → Connect Linear, or `liminal connect linear`)");
        }
      } else {
        for (const a of linearAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          lines.push(
            `- ${a.organizationName ?? a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes)`
          );
        }
      }
      lines.push("");

      const notionAccounts = await listNotionOAuthAccounts();
      lines.push("### Notion OAuth");
      if (notionAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("notion");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("notion")}`);
        } else {
          lines.push("- (not connected — Settings → Integrations → Connect Notion, or `liminal connect notion`)");
        }
      } else {
        for (const a of notionAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          lines.push(
            `- ${a.workspaceName ?? a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes)`
          );
        }
      }
      lines.push("");

      lines.push("### GitHub OAuth");
      if (ghAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("github");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("github")}`);
        } else if (githubTokenPresent()) {
          lines.push("- (using GITHUB_TOKEN from env — hosted OAuth not connected)");
        } else {
          lines.push("- (not connected — Settings → Integrations → Connect GitHub)");
        }
      } else {
        for (const a of ghAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          lines.push(
            `- ${a.login ?? a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes)`
          );
        }
      }
      const githubConns = await listConnectionsByParent(GITHUB_PARENT_PROVIDER);
      lines.push("### GitHub MCP connections");
      if (githubConns.length === 0) {
        lines.push(
          "- (not attached — connect_provider({ provider: \"github\" }) or Settings → Integrations → Connect)"
        );
      } else {
        for (const c of githubConns) {
          lines.push(`- ${c.name}: ${c.tools.length} tools, readOnly=${!!c.readOnly}, url=${c.serverUrl ?? "?"}`);
        }
      }
      lines.push("");

      const googleAccounts = await listGoogleOAuthAccounts();
      const msAccounts = await listMicrosoftOAuthAccounts();
      lines.push("### Microsoft OAuth");
      if (msAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("microsoft");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("microsoft")}`);
        } else {
          lines.push("- (not connected — Settings → Integrations → Microsoft 365)");
        }
      } else {
        for (const a of msAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          const miss = missingDefaultMicrosoftScopes(a.scopes);
          lines.push(
            `- ${a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes${miss.length ? `, missing ${miss.length} default scopes` : ""})`
          );
        }
      }
      const azAccounts = await listAzureOAuthAccounts();
      lines.push("### Azure OAuth");
      if (azAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("azure");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("azure")}`);
        } else {
          lines.push("- (not connected — Settings → Integrations → Azure, or `az login` for REST only)");
        }
      } else {
        for (const a of azAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          lines.push(`- ${a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes)`);
        }
      }
      const azSidecar = await getAzureSidecarStatus();
      lines.push(
        `Azure sidecar: enabled=${azSidecar.enabled}, running=${azSidecar.running}, url=${azSidecar.url}`
      );
      const azConns = await listConnectionsByParent(AZURE_PARENT_PROVIDER);
      lines.push("### Azure MCP connections");
      if (azConns.length === 0) {
        lines.push("- (none — connect_provider({ provider: \"azure\" }))");
      } else {
        for (const c of azConns) {
          lines.push(
            `- ${c.name}: ${c.tools.length} tools, services=[${(c.services ?? []).join(",")}], readOnly=${!!c.readOnly}`
          );
        }
      }
      lines.push("");

      const msSidecar = await getMicrosoftSidecarStatus();
      lines.push(
        `Sidecar: enabled=${msSidecar.enabled}, running=${msSidecar.running}, url=${msSidecar.url}`
      );
      const msConns = await listConnectionsByParent(MICROSOFT_PARENT_PROVIDER);
      lines.push("### Microsoft MCP connections");
      if (msConns.length === 0) {
        lines.push("- (none — connect_provider({ provider: \"microsoft_365\" }))");
      } else {
        for (const c of msConns) {
          lines.push(
            `- ${c.name}: ${c.tools.length} tools, services=[${(c.services ?? []).join(",")}], readOnly=${!!c.readOnly}`
          );
        }
      }
      lines.push("");

      lines.push("### Google OAuth");
      if (googleAccounts.length === 0) {
        const onDisk = await countOAuthAccountFiles("google");
        if (onDisk > 0) {
          lines.push(`- (tokens on disk but unreadable in this process — ${onDisk} file(s))`);
          lines.push(`  ${oauthDecryptHint("google")}`);
        } else {
          lines.push("- (not connected — run `liminal connect google --attach` from a shell with your project .env)");
        }
      } else {
        for (const a of googleAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          const hasGmailModify = a.scopes.includes("https://www.googleapis.com/auth/gmail.modify");
          const gmailPresets = resolveGoogleServices(["gmail"]);
          const gmailScopesOk = missingGoogleScopes(a.scopes, gmailPresets).length === 0;
          const hasDriveMcp = a.scopes.includes("https://www.googleapis.com/auth/drive.file");
          const calPresets = resolveGoogleServices(["calendar"]);
          const hasCalScopes = missingGoogleScopes(a.scopes, calPresets).length === 0;
          lines.push(
            `- ${a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes, gmail=${gmailScopesOk ? "yes" : "NO"}, gmail_modify=${hasGmailModify ? "yes" : "no"}, drive_scopes=${hasDriveMcp ? "yes" : "partial"}, calendar_scopes=${hasCalScopes ? "yes" : "NO — revoke + reconnect OAuth"})`
          );
          const gmailOnly = resolveGoogleServices(["gmail"]);
          const miss = missingGoogleScopes(a.scopes, gmailOnly);
          if (miss.length > 0) {
            lines.push(`  - missing for gmail: ${miss.join(", ")}`);
          }
          const workspaceMiss = missingDefaultWorkspaceScopes(a.scopes);
          if (workspaceMiss.length > 0) {
            lines.push(
              `  - missing for full workspace (${workspaceMiss.length}): ${workspaceMiss.slice(0, 4).join(", ")}` +
                `${workspaceMiss.length > 4 ? ` (+${workspaceMiss.length - 4} more)` : ""} — revoke at https://myaccount.google.com/permissions and reconnect OAuth`
            );
          }
        }
      }
      lines.push("");

      const sidecar = await getGoogleSidecarStatus();
      lines.push("### Google sidecar (Docs/Sheets/Slides/…)");
      lines.push(
        `- enabled: ${sidecar.enabled}, running: ${sidecar.running}, url: ${sidecar.url}` +
          (sidecar.pid ? `, pid: ${sidecar.pid}` : "")
      );
      lines.push("");

      const all = await listConnections();
      const google = all.filter(
        (c): c is McpConnectionRecord => c.kind === "mcp" && c.parentProvider === PARENT_PROVIDER
      );
      lines.push("### Google MCP connections (live tool registry)");
      const calConn = google.find((c) => c.name === "google_calendar");
      lines.push(
        `- calendar: ${calConn ? `attached (${calConn.tools.length} tools)` : "NOT attached — Integrations → Attach MCP tools or connect_provider with calendar in services[]"}`
      );
      if (google.length === 0) {
        lines.push("- (none — call connect_provider)");
      } else {
        for (const c of google) {
          const oauthLabel =
            c.oauthAccountId || (c.auth.kind === "oauth2" && c.auth.accountId)
              ? `, oauthAccount=${c.oauthAccountId ?? (c.auth.kind === "oauth2" ? c.auth.accountId : "")}`
              : "";
          lines.push(
            `- ${c.name}: ${c.tools.length} tools, services=[${(c.services ?? []).join(",")}], readOnly=${!!c.readOnly}${oauthLabel}`
          );
          if (c.name === "google_gmail" && c.readOnly) {
            lines.push(
              "  - readOnly hides MCP draft/label writes; immediate send still uses gmail_send_message (REST) when OAuth is readable."
            );
            lines.push(
              "  - For MCP drafts too: connect_provider({ provider: \"google_workspace\", services: [\"gmail\"], mode: \"read_write\" })."
            );
          }
        }
      }
      lines.push("");
      lines.push(...(await buildIntegrationLiveProbeLines()));
      lines.push("");
      lines.push("### Cloud Console reference (enable MCP APIs when live probe says disabled)");
      const projectId = googleProjectIdFromClientId();
      for (const [svc, apiId] of Object.entries(GOOGLE_OFFICIAL_MCP_API_IDS)) {
        const url = googleCloudMcpApiLibraryUrl(svc as GoogleServiceId, projectId);
        lines.push(`- ${apiId}${url ? ` → ${url}` : ""}`);
      }

      return { ok: true, output: lines.join("\n") };
    },
  });

  return { connectProviderTool, disconnectProviderTool, listConnectorsTool };
}

function normalizeRegistries(registry: ToolRegistry | ToolRegistry[]): ToolRegistry[] {
  return Array.isArray(registry) ? registry : [registry];
}

async function disconnectGoogleWorkspaceMcp(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth: boolean
): Promise<ToolResult> {
  const registries = normalizeRegistries(registry);
  const conns = await listGoogleWorkspaceConnections();
  let removed = 0;
  let hadSidecar = false;
  for (const c of conns) {
    if (c.sidecarManaged) hadSidecar = true;
    for (const reg of registries) {
      removed += unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
  }

  if (hadSidecar) await releaseGoogleSidecar();

  if (revokeOAuth) {
    const accounts = await listGoogleOAuthAccounts();
    for (const a of accounts) {
      await revokeGoogleAccount(a.accountId);
    }
    await stopGoogleSidecar(true);
  }

  return {
    ok: true,
    output:
      `Disconnected google_workspace${revokeOAuth ? " (OAuth tokens revoked)" : ""}. ` +
      `Removed ${removed} tools from ${conns.length} connection(s).`,
  };
}

async function disconnectAzureMcp(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth: boolean
): Promise<ToolResult> {
  const registries = normalizeRegistries(registry);
  const conns = await listAzureConnections();
  let removed = 0;
  let hadSidecar = false;
  for (const c of conns) {
    if (c.sidecarManaged) hadSidecar = true;
    for (const reg of registries) {
      removed += unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
  }
  if (hadSidecar) await releaseAzureSidecar();
  if (revokeOAuth) {
    const accounts = await listAzureOAuthAccounts();
    for (const a of accounts) {
      await revokeAzureAccount(a.accountId);
    }
    await stopAzureSidecar(true);
  }
  return {
    ok: true,
    output:
      `Disconnected azure${revokeOAuth ? " (OAuth tokens revoked)" : ""}. ` +
      `Removed ${removed} tools from ${conns.length} connection(s).`,
  };
}

async function disconnectMicrosoft365Mcp(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth: boolean
): Promise<ToolResult> {
  const registries = normalizeRegistries(registry);
  const conns = await listMicrosoft365Connections();
  let removed = 0;
  let hadSidecar = false;
  for (const c of conns) {
    if (c.sidecarManaged) hadSidecar = true;
    for (const reg of registries) {
      removed += unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
  }
  if (hadSidecar) await releaseMicrosoftSidecar();
  if (revokeOAuth) {
    const accounts = await listMicrosoftOAuthAccounts();
    for (const a of accounts) {
      await revokeMicrosoftAccount(a.accountId);
    }
    await stopMicrosoftSidecar(true);
  }
  return {
    ok: true,
    output:
      `Disconnected microsoft_365${revokeOAuth ? " (OAuth tokens revoked)" : ""}. ` +
      `Removed ${removed} tools from ${conns.length} connection(s).`,
  };
}

export async function disconnectGoogleWorkspaceFromServer(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const result = await disconnectGoogleWorkspaceMcp(registry, revokeOAuth);
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

/** Server-side GitHub MCP connect (web API / boot). */
export async function connectGithubFromServer(
  registry: ToolRegistry,
  opts?: { readOnly?: boolean }
): Promise<{ ok: boolean; output?: string; error?: string; toolCount?: number }> {
  const result = await connectGithubMcp(registry, opts);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, output: result.output, toolCount: result.toolCount };
}

export async function disconnectGithubFromServer(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const result = await disconnectGithubMcp(registry, revokeOAuth);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, output: result.output };
}

export async function disconnectMicrosoft365FromServer(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const result = await disconnectMicrosoft365Mcp(registry, revokeOAuth);
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

/** Server-side Microsoft 365 connect (web API). */
export async function connectAzureFromServer(
  registry: ToolRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only"; accountId?: string }
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({
    provider: "azure",
    services: opts.services,
    mode: opts.mode ?? "read_write",
    account_hint: opts.accountId,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function disconnectAzureFromServer(
  registry: ToolRegistry | ToolRegistry[],
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const result = await disconnectAzureMcp(registry, revokeOAuth);
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function connectMicrosoft365FromServer(
  registry: ToolRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only"; accountId?: string }
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({
    provider: "microsoft_365",
    services: opts.services,
    mode: opts.mode ?? "read_write",
    account_hint: opts.accountId,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

/** Server-side Google Workspace connect (web API). */
export async function connectGoogleWorkspaceFromServer(
  registry: ToolRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only"; accountId?: string }
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({
    provider: "google_workspace",
    services: opts.services,
    mode: opts.mode ?? "read_write",
    account_hint: opts.accountId,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

/** Server-side Xero connect status (web API). */
export async function connectXeroFromServer(
  registry: ToolRegistry
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({ provider: "xero" });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function disconnectXeroFromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "xero",
    revoke_oauth: revokeOAuth,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function connectSlackFromServer(
  registry: ToolRegistry
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({ provider: "slack" });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function disconnectSlackFromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "slack",
    revoke_oauth: revokeOAuth,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function connectLinearFromServer(
  registry: ToolRegistry
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({ provider: "linear" });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function disconnectLinearFromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "linear",
    revoke_oauth: revokeOAuth,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function connectNotionFromServer(
  registry: ToolRegistry
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({ provider: "notion" });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function disconnectNotionFromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "notion",
    revoke_oauth: revokeOAuth,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function connectYoutubeFromServer(
  registry: ToolRegistry
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { connectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await connectProviderTool.handler({ provider: "youtube" });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

export async function disconnectYoutubeFromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "youtube",
    revoke_oauth: revokeOAuth,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}
