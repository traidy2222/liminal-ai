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
  listXeroOAuthAccounts,
  revokeXeroAccount,
} from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  deleteConnection,
  googleOAuthAuthScheme,
  microsoftOAuthAuthScheme,
  listConnections,
  listConnectionsByParent,
  type McpConnectionRecord,
} from "./api_connections_store.js";
import { attachMcpConnection, unregisterMcpConnection } from "./mcp_attach.js";
import { gmailSendRestEnabled } from "./google_gmail_send.js";
import { calendarRestEnabled } from "./google_calendar_rest.js";
import { officeRestEnabled } from "./google_office_rest.js";
import { ensureGoogleSidecarRunning, releaseGoogleSidecar, stopGoogleSidecar, getGoogleSidecarStatus } from "./google_sidecar.js";
import {
  ensureMicrosoftSidecarRunning,
  releaseMicrosoftSidecar,
  stopMicrosoftSidecar,
  getMicrosoftSidecarStatus,
} from "./microsoft_sidecar.js";
import { outlookRestEnabled } from "./outlook_send.js";
import { microsoftCalendarRestEnabled } from "./microsoft_calendar_rest.js";
import { onedriveRestEnabled } from "./onedrive_rest.js";
import { excelRestEnabled } from "./excel_rest.js";
import { microsoftOfficeRestEnabled } from "./microsoft_office_rest.js";
import { graphSearchRestEnabled } from "./graph_search_rest.js";
import { xeroRestEnabled } from "./xero_rest.js";
import {
  connectGithubMcp,
  disconnectGithubMcp,
  githubMcpEnabled,
  githubTokenPresent,
  GITHUB_PARENT_PROVIDER,
} from "./github_connect.js";

const PARENT_PROVIDER = "google_workspace";
const MICROSOFT_PARENT_PROVIDER = "microsoft_365";

function integrationLazyLoadHint(registry: ToolRegistry): string {
  if (!registry.isLazyToolLoading()) return "";
  return (
    "\nLazy loading: MCP tools are registered but inactive until activate_tool_family({ family: \"connectors\" })."
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

async function connectMicrosoft365Handler(
  registry: ToolRegistry,
  args: Record<string, unknown>
): Promise<ToolResult> {
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
    return {
      ok: false,
      error:
        "Microsoft OAuth not configured or no token on disk.\n\n" +
        "Connect first: Settings → Integrations → Microsoft 365, or run OAuth flow.\n" +
        "Set MICROSOFT_OAUTH_CLIENT_ID in .env (see docs/guides/microsoft-365.md).",
    };
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
      integrationLazyLoadHint(registry) +
      partial,
  };
}

export function createConnectorTools(registry: ToolRegistry, _emitter: AgentEmitter) {
  const connectProviderTool = defineTool({
    name: "connect_provider",
    description:
      "WHAT: Connect curated providers — Google Workspace, Microsoft 365 (OAuth), Xero (OAuth), or GitHub (PAT).\n" +
      "WHEN: User asks to work with Google/Microsoft mail, calendar, files, Xero accounting, or GitHub repos.\n" +
      "HOW: google_workspace / microsoft_365 / xero → OAuth via Settings → Integrations; github → GITHUB_TOKEN in .env.",
    parameters: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["google_workspace", "microsoft_365", "xero", "github"],
          description: "Provider preset id.",
        },
        services: {
          type: "array",
          items: { type: "string" },
          description:
            "Google: drive, gmail, calendar, … — Microsoft: mail, calendar, onedrive, teams, … Default: all for chosen provider.",
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
    handler: async (args): Promise<ToolResult> => {
      const provider = String(args["provider"] ?? "").trim();
      if (provider === "github") {
        const result = await connectGithubMcp(registry, {
          readOnly: args["mode"] === "read_only",
        });
        if (!result.ok) return { ok: false, error: result.error };
        return { ok: true, output: result.output };
      }
      if (provider === "microsoft_365") {
        return connectMicrosoft365Handler(registry, args);
      }
      if (provider === "xero") {
        const accounts = await listXeroOAuthAccounts();
        if (accounts.length === 0) {
          return {
            ok: false,
            error:
              "Xero OAuth not connected — open Settings → Integrations → Connect Xero (hosted sign-in, no .env setup).",
          };
        }
        const a = accounts[0]!;
        return {
          ok: true,
          output:
            `Xero connected as ${a.email ?? a.accountId}` +
            (a.tenantName ? ` (${a.tenantName})` : a.tenantId ? ` (tenant ${a.tenantId})` : "") +
            ".\nTools: xero_list_organisations, xero_list_invoices, xero_get_invoice, xero_list_contacts, xero_create_invoice.",
        };
      }
      if (provider !== "google_workspace") {
        return { ok: false, error: `unsupported provider '${provider}'` };
      }

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
        const scopes = scopesForGoogleServices(presets, mode);
        let authUrlHint = "";
        try {
          authUrlHint =
            "\n\nConnect first: run `liminal connect google --attach` or open Settings → Integrations → Connect Google, then Attach MCP tools.\n" +
            `(OAuth scopes needed: ${scopes.slice(0, 4).join(", ")}${scopes.length > 4 ? "…" : ""})`;
        } catch {
          authUrlHint = "\n\nSet GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in .env, then connect via Settings or CLI.";
        }
        return {
          ok: false,
          error: `Google OAuth not configured or no token on disk.${authUrlHint}`,
        };
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

      for (const [connName, group] of byConn) {
        if (connName === "google_ext") continue;
        const preset = group[0]!;
        if (!preset.mcpUrl) continue;
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
          attachErrors.push(`${connName}: ${e instanceof Error ? e.message : String(e)}`);
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

      return {
        ok: true,
        output:
          `Connected google_workspace as ${oauth.email ?? oauth.accountId} (${mode}).\n` +
          `Connections: ${attached.join(", ")}\n` +
          `Registered MCP tools: ${totalTools}\n` +
          `Services attached: ${attached.join(", ")}` +
          integrationLazyLoadHint(registry) +
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
        provider: { type: "string", enum: ["google_workspace", "microsoft_365", "xero", "github"] },
        revoke_oauth: {
          type: "boolean",
          description: "Google/Microsoft/Xero: delete local OAuth tokens (default false).",
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
        const result = await disconnectGithubMcp(registry);
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
      if (provider === "microsoft_365") {
        const conns = await listConnectionsByParent(MICROSOFT_PARENT_PROVIDER);
        let removed = 0;
        let hadSidecar = false;
        for (const c of conns) {
          if (c.sidecarManaged) hadSidecar = true;
          removed += unregisterMcpConnection(registry, c);
          await deleteConnection(c.name);
        }
        if (hadSidecar) await releaseMicrosoftSidecar();
        if (args["revoke_oauth"] === true) {
          const accounts = await listMicrosoftOAuthAccounts();
          for (const a of accounts) {
            await revokeMicrosoftAccount(a.accountId);
          }
          await stopMicrosoftSidecar(true);
        }
        return {
          ok: true,
          output: `Disconnected microsoft_365. Removed ${removed} tools from ${conns.length} connection(s).`,
        };
      }
      if (provider !== "google_workspace") {
        return { ok: false, error: `unsupported provider '${provider}'` };
      }

      const conns = await listConnectionsByParent(PARENT_PROVIDER);
      let removed = 0;
      let hadSidecar = false;
      for (const c of conns) {
        if (c.sidecarManaged) hadSidecar = true;
        removed += unregisterMcpConnection(registry, c);
        await deleteConnection(c.name);
      }

      if (hadSidecar) await releaseGoogleSidecar();

      if (args["revoke_oauth"] === true) {
        const accounts = await listGoogleOAuthAccounts();
        for (const a of accounts) {
          await revokeGoogleAccount(a.accountId);
        }
        await stopGoogleSidecar(true);
      }

      return {
        ok: true,
        output: `Disconnected ${provider}. Removed ${removed} tools from ${conns.length} connection(s).`,
      };
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
      lines.push(
        "Mail routing: use Google/Gmail tools for primary mail unless the user names Outlook/Microsoft. " +
          "Entra guest accounts (#EXT#@*.onmicrosoft.com) are not day-to-day mailboxes."
      );
      lines.push("");
      lines.push(
        `Gmail: hybrid — mcp_google_gmail_* (read/search/labels) + gmail_create_draft + gmail_send_message REST: ${
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
        `GitHub: mcp_github_* via GitHub MCP — ${githubMcpEnabled() ? "enabled" : "off (AGENT_GITHUB_MCP=0)"}, token=${
          githubTokenPresent() ? "set in env" : "MISSING (set GITHUB_TOKEN in .env)"
        }`
      );
      lines.push(
        `Microsoft 365: mcp_microsoft_* sidecar + outlook/calendar/onedrive REST — outlook=${outlookRestEnabled()}, calendar=${microsoftCalendarRestEnabled()}, onedrive=${onedriveRestEnabled()}, office=${microsoftOfficeRestEnabled()}`
      );
      lines.push(
        `Xero: REST accounting tools — ${xeroRestEnabled() ? "on" : "off (set AGENT_XERO_REST=0 to disable)"}, connect via Settings → Integrations (hosted OAuth)`
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
          lines.push(
            `- ${a.email ?? a.accountId}${a.tenantName ? ` · ${a.tenantName}` : a.tenantId ? ` · tenant ${a.tenantId}` : ""} (expires ~${exp}, ${a.scopes.length} scopes)`
          );
        }
      }
      lines.push("");

      const githubConns = await listConnectionsByParent(GITHUB_PARENT_PROVIDER);
      lines.push("### GitHub MCP");
      if (githubConns.length === 0) {
        lines.push(
          "- (not attached — connect_provider({ provider: \"github\" }) or set GITHUB_TOKEN + restart with AGENT_GITHUB_CONNECT_ON_BOOT=1)"
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
          const hasGmailRead = a.scopes.includes("https://www.googleapis.com/auth/gmail.readonly");
          const hasGmailCompose = a.scopes.includes("https://www.googleapis.com/auth/gmail.compose");
          const hasDriveMcp = a.scopes.includes("https://www.googleapis.com/auth/drive.file");
          const calPresets = resolveGoogleServices(["calendar"]);
          const hasCalScopes = missingGoogleScopes(a.scopes, calPresets).length === 0;
          lines.push(
            `- ${a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes, gmail_mcp=${hasGmailRead && hasGmailCompose ? "yes" : "NO"}, drive_scopes=${hasDriveMcp ? "yes" : "partial"}, calendar_scopes=${hasCalScopes ? "yes" : "NO — revoke + reconnect OAuth"})`
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
          lines.push(
            `- ${c.name}: ${c.tools.length} tools, services=[${(c.services ?? []).join(",")}], readOnly=${!!c.readOnly}`
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
      lines.push("### Official MCP APIs (Cloud Console checklist — not a live probe)");
      lines.push(
        "If a specific MCP attach failed with 403, enable the matching MCP API below and enroll in Workspace Developer Preview:"
      );
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

export async function disconnectGoogleWorkspaceFromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "google_workspace",
    revoke_oauth: revokeOAuth,
  });
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
  registry: ToolRegistry
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const result = await disconnectGithubMcp(registry);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, output: result.output };
}

export async function disconnectMicrosoft365FromServer(
  registry: ToolRegistry,
  revokeOAuth = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const { disconnectProviderTool } = createConnectorTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await disconnectProviderTool.handler({
    provider: "microsoft_365",
    revoke_oauth: revokeOAuth,
  });
  if (result.ok) return { ok: true, output: result.output };
  return { ok: false, error: result.error };
}

/** Server-side Microsoft 365 connect (web API). */
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
