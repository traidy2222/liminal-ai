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
  GOOGLE_OFFICIAL_MCP_API_IDS,
  googleCloudMcpApiLibraryUrl,
  googleProjectIdFromClientId,
  resolveGoogleGmailTransport,
  type GoogleServiceId,
  type GoogleServicePreset,
} from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  deleteConnection,
  googleOAuthAuthScheme,
  listConnections,
  listConnectionsByParent,
  type McpConnectionRecord,
} from "./api_connections_store.js";
import { attachMcpConnection, unregisterMcpConnection } from "./mcp_attach.js";
import { ensureGoogleSidecarRunning, releaseGoogleSidecar, stopGoogleSidecar, getGoogleSidecarStatus } from "./google_sidecar.js";

const PARENT_PROVIDER = "google_workspace";

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
      : accounts[0];
    if (match) return { accountId: match.accountId, email: match.email };
  }
  return null;
}

export function createConnectorTools(registry: ToolRegistry, _emitter: AgentEmitter) {
  const connectProviderTool = defineTool({
    name: "connect_provider",
    description:
      "WHAT: Connect a curated external provider (Google Workspace: Drive, Gmail, Calendar, Docs, Sheets, …).\n" +
      "WHEN: User asks to work with Google Docs/Sheets/Drive/Gmail and connectors are not yet active.\n" +
      "HOW: provider='google_workspace', optional services[] and mode read_only|read_write. " +
      "Requires prior OAuth via Settings → Integrations or `liminal connect google`.",
    parameters: {
      type: "object",
      properties: {
        provider: {
          type: "string",
          enum: ["google_workspace"],
          description: "Provider preset id.",
        },
        services: {
          type: "array",
          items: { type: "string" },
          description: "Subset: drive, gmail, calendar, chat, people, docs, sheets, slides, forms, tasks, contacts, apps_script, search. Default: all.",
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
      if (provider !== "google_workspace") {
        return { ok: false, error: `unsupported provider '${provider}' (only google_workspace in v1)` };
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
      const missing = missingGoogleScopes(granted, presets);
      if (missing.length > 0) {
        return {
          ok: false,
          error:
            formatGoogleScopeDiagnostics(granted, presets) +
            "\n\nAlso enable each Google API in Cloud Console (APIs & Services → Library): Gmail API, Google Drive API, Calendar API, etc.",
        };
      }

      const scopes = scopesForGoogleServices(presets, mode);
      const auth = googleOAuthAuthScheme(oauth.accountId, scopes);
      const readOnly = mode === "read_only";

      // Gmail transport: in `rest` mode do NOT attach the preview Gmail MCP
      // (gmailmcp.googleapis.com is invite-only and 403s for most projects).
      // The always-registered classic-REST gmail_api_* tools cover Gmail instead.
      // OAuth scopes above still include gmail.* so the REST tools work.
      const gmailTransport = resolveGoogleGmailTransport();
      const gmailRequested = presets.some((p) => p.id === "gmail");
      const skipGmailMcp = gmailTransport === "rest" && gmailRequested;
      const attachPresets = skipGmailMcp ? presets.filter((p) => p.id !== "gmail") : presets;

      const byConn = uniqueConnectionNames(attachPresets);
      const attached: string[] = [];
      let totalTools = 0;

      try {
        if (needsGoogleSidecar(attachPresets)) {
          const accessToken = await getGoogleAccessToken(oauth.accountId);
          const sidecar = await ensureGoogleSidecarRunning(accessToken ?? undefined);
          if (!sidecar.ok) {
            return {
              ok: false,
              error: `Google sidecar failed: ${sidecar.error}. Install uv (` +
                `https://docs.astral.sh/uv/) and ensure workspace-mcp is available via uvx.`,
            };
          }
          const sidecarServices = attachPresets.filter((p) => p.backend === "google_sidecar").map((p) => p.id);
          const { registered } = await attachMcpConnection(registry, {
            name: "google_ext",
            url: sidecar.url,
            auth,
            readOnly,
            autoActivate: true,
            providerId: "google_ext",
            parentProvider: PARENT_PROVIDER,
            services: sidecarServices,
            oauthAccountId: oauth.accountId,
            sidecarManaged: true,
          });
          attached.push("google_ext");
          totalTools += registered.length;
        }

        for (const [connName, group] of byConn) {
          if (connName === "google_ext") continue;
          const preset = group[0]!;
          if (!preset.mcpUrl) continue;
          const { registered } = await attachMcpConnection(registry, {
            name: connName,
            url: preset.mcpUrl,
            auth,
            readOnly,
            autoActivate: true,
            providerId: preset.id,
            parentProvider: PARENT_PROVIDER,
            services: group.map((g) => g.id),
            oauthAccountId: oauth.accountId,
          });
          attached.push(connName);
          totalTools += registered.length;
        }
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }

      const gmailNote = skipGmailMcp
        ? `\nGmail: using classic REST tools (gmail_api_*) — preview MCP skipped (AGENT_GOOGLE_GMAIL_TRANSPORT=rest).`
        : "";
      return {
        ok: true,
        output:
          `Connected google_workspace as ${oauth.email ?? oauth.accountId} (${mode}).\n` +
          `Connections: ${attached.length ? attached.join(", ") : "(none — using REST/sidecar only)"}\n` +
          `Active MCP tools: ${totalTools}\n` +
          `Services: ${presets.map((p) => p.id).join(", ")}` +
          gmailNote,
      };
    },
  });

  const disconnectProviderTool = defineTool({
    name: "disconnect_provider",
    description: "Disconnect a curated provider (google_workspace) — removes MCP connections and optionally revokes OAuth.",
    parameters: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["google_workspace"] },
        revoke_oauth: { type: "boolean", description: "Also revoke Google OAuth token (default false)." },
      },
      required: ["provider"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const provider = String(args["provider"] ?? "").trim();
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

      const gmailTransport = resolveGoogleGmailTransport();
      lines.push(
        `Gmail transport: ${gmailTransport}` +
          (gmailTransport === "rest"
            ? " — using classic REST tools (gmail_api_*); preview MCP not attached. Switch in Settings → Harness → Gmail Transport."
            : gmailTransport === "mcp"
              ? " — preview mcp_google_gmail_* only (needs preview enrollment + gmailmcp.googleapis.com enabled)."
              : " — preview MCP attached with REST (gmail_api_*) as fallback.")
      );
      lines.push("");

      const googleAccounts = await listGoogleOAuthAccounts();
      lines.push("### Google OAuth");
      if (googleAccounts.length === 0) {
        lines.push("- (not connected — use Settings → Integrations or `liminal connect google`)");
      } else {
        for (const a of googleAccounts) {
          const exp = new Date(a.expiresAt).toISOString();
          const hasGmailRead = a.scopes.includes("https://www.googleapis.com/auth/gmail.readonly");
          const hasGmailCompose = a.scopes.includes("https://www.googleapis.com/auth/gmail.compose");
          const hasDriveMcp = a.scopes.includes("https://www.googleapis.com/auth/drive.file");
          lines.push(
            `- ${a.email ?? a.accountId} (expires ~${exp}, ${a.scopes.length} scopes, gmail_mcp=${hasGmailRead && hasGmailCompose ? "yes" : "NO — re-run liminal connect google --attach"}, drive_mcp=${hasDriveMcp ? "yes" : "partial"})`
          );
          const gmailOnly = resolveGoogleServices(["gmail"]);
          const miss = missingGoogleScopes(a.scopes, gmailOnly);
          if (miss.length > 0) {
            lines.push(`  - missing for gmail: ${miss.join(", ")}`);
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
      lines.push("### Google MCP connections");
      if (google.length === 0) {
        lines.push("- (none — call connect_provider)");
      } else {
        for (const c of google) {
          lines.push(
            `- ${c.name}: ${c.tools.length} tools, services=[${(c.services ?? []).join(",")}], readOnly=${!!c.readOnly}`
          );
        }
      }
      lines.push("");
      lines.push("### Official MCP APIs (separate from Gmail/Drive API)");
      lines.push(
        "Enable these in Cloud Console for MCP tools (403 often means MCP API disabled while classic API works):"
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
