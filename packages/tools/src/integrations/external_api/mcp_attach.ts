/**
 * MCP (Model Context Protocol) attach — register a remote MCP server's tools
 * as local harness tools.
 */
import type { AgentEmitter, ToolDefinition, ToolRegistry, ToolResult, PropertySchema } from "@liminal/core";
import { cleanMcpCallArgs, expandMcpToolProperties } from "@liminal/core";
import { enrichGoogleMcpToolDescription } from "../google/google_mcp_tool_hints.js";
import {
  type GoogleServiceId,
  effectiveHarnessEnvRaw,
  googleCloudMcpApiLibraryUrl,
  googleProjectIdFromClientId,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  type AuthScheme,
  type McpConnectionRecord,
  type McpToolFilter,
  type McpToolRecord,
  deleteConnection,
  googleOAuthAuthScheme,
  listConnections,
  readConnection,
  resolveAuthHeaderAsync,
  sanitizeConnectionName,
  writeConnection,
} from "./api_connections_store.js";
import { filterMcpToolRecords, isMcpReadTool, isMcpWriteTool } from "./mcp_tool_classify.js";
import { registerConnectorToolFamilies } from "../../shared/connector_family_map.js";
import { validateOutboundEmailStyle } from "../google/gmail_compose_guard.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_CLIENT_INFO = { name: "liminal-harness", version: "0.1.0" };
const MCP_FETCH_TIMEOUT_MS = 60_000;

let jsonRpcCounter = 1;
function nextJsonRpcId(): number {
  return jsonRpcCounter++;
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id?: number | string;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

async function postJsonRpc<T>(
  serverUrl: string,
  body: object,
  auth: AuthScheme,
  expectReply: boolean
): Promise<JsonRpcResponse<T> | null> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    ...(await resolveAuthHeaderAsync(auth)),
  };
  const res = await fetch(serverUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS),
  });
  if (!expectReply) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse<T>;
        if (parsed && parsed.jsonrpc === "2.0") return parsed;
      } catch {
        /* continue */
      }
    }
    throw new Error("SSE response contained no JSON-RPC payload");
  }
  return (await res.json()) as JsonRpcResponse<T>;
}

interface McpToolsListResult {
  tools: Array<{
    name: string;
    description?: string;
    inputSchema?: Record<string, unknown>;
  }>;
}

interface McpToolCallResult {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
}

export async function mcpHandshakeAndListTools(
  serverUrl: string,
  auth: AuthScheme
): Promise<McpToolRecord[]> {
  await postJsonRpc<{ protocolVersion?: string }>(
    serverUrl,
    {
      jsonrpc: "2.0",
      id: nextJsonRpcId(),
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
    },
    auth,
    true
  );
  try {
    await postJsonRpc(
      serverUrl,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      auth,
      false
    );
  } catch {
    /* tolerate */
  }
  const reply = await postJsonRpc<McpToolsListResult>(
    serverUrl,
    { jsonrpc: "2.0", id: nextJsonRpcId(), method: "tools/list" },
    auth,
    true
  );
  if (!reply || reply.error) {
    throw new Error(`tools/list failed: ${reply?.error?.message ?? "no response"}`);
  }
  const list = reply.result?.tools ?? [];
  return list.map((t) => ({
    remoteName: t.name,
    toolName: "",
    description: (t.description ?? "").slice(0, 800),
    inputSchema: t.inputSchema ?? { type: "object", properties: {}, additionalProperties: true },
  }));
}

function ensureToolParameterShape(schema: Record<string, unknown>): {
  properties: Record<string, PropertySchema>;
  required: string[];
} {
  const props = (schema["properties"] as Record<string, PropertySchema> | undefined) ?? {};
  const required = Array.isArray(schema["required"]) ? (schema["required"] as string[]) : [];
  return { properties: props, required };
}

const MCP_HOST_TO_SERVICE: Array<{ host: string; service: GoogleServiceId }> = [
  { host: "gmailmcp.googleapis.com", service: "gmail" },
  { host: "drivemcp.googleapis.com", service: "drive" },
  { host: "calendarmcp.googleapis.com", service: "calendar" },
  { host: "chatmcp.googleapis.com", service: "chat" },
  { host: "people.googleapis.com", service: "people" },
];

export function enrichGoogleMcpProbeError(serverUrl: string, message: string): string {
  let host = "";
  try {
    host = new URL(serverUrl).hostname;
  } catch {
    /* ignore */
  }

  if (/400|Unknown name|Invalid JSON payload/i.test(message)) {
    const match = MCP_HOST_TO_SERVICE.find((e) => host === e.host);
    if (match) {
      return (
        `${message}\n\n` +
        `Google ${match.service} MCP rejects **unknown argument fields** with HTTP 400. ` +
        `Use only parameters declared on the tool schema (extra keys like calendarId on list_calendars, ` +
        `time_max on Gmail, or both pageSize and page_size together will fail).`
      );
    }
  }

  if (/403|Forbidden|does not have permission|insufficient.*scope/i.test(message)) {
    if (host === "people.googleapis.com") {
      return (
        `${message}\n\n` +
        "People MCP (`get_user_profile`, directory search) needs:\n" +
        "- **People API** enabled in Cloud Console (people.googleapis.com)\n" +
        "- OAuth scopes: contacts.readonly / contacts (+ directory.readonly for Workspace directory)\n" +
        "- Re-connect Google after scope changes; `directory.readonly` requires Workspace admin for org directory\n" +
        "- Workspace Developer Preview enrollment for official MCP (same as Gmail/Drive MCP)"
      );
    }
    const match = MCP_HOST_TO_SERVICE.find((e) => host === e.host);
    if (match) {
      return (
        `${message}\n\n` +
        `Google ${match.service} MCP often returns 403 when the **MCP API** is disabled, OAuth scopes are stale, or the Cloud project is not enrolled in the [Workspace Developer Preview](https://developers.google.com/workspace/preview). Re-connect Google Workspace after enabling APIs.`
      );
    }
  }

  if (!/MCP API has not been used|is disabled/i.test(message)) return message;
  const match = MCP_HOST_TO_SERVICE.find((e) => host === e.host);
  if (!match) return message;
  const projectId = googleProjectIdFromClientId();
  const enableUrl = googleCloudMcpApiLibraryUrl(match.service, projectId);
  const classic =
    match.service === "gmail"
      ? "Gmail API (gmail.googleapis.com)"
      : match.service === "drive"
        ? "Google Drive API"
        : `${match.service} API`;
  return (
    `${message}\n\n` +
    `Note: ${classic} can work while ${host} is still disabled — they are separate products in Google Cloud.\n` +
    (enableUrl ? `Enable **${host}** here: ${enableUrl}\n` : "") +
    `Then wait 1–2 minutes and retry (no need to re-OAuth).`
  );
}

function buildMcpToolHandler(
  record: McpConnectionRecord,
  tool: McpToolRecord,
  remoteProperties: Record<string, unknown>
): ToolDefinition["handler"] {
  return async (args): Promise<ToolResult> => {
    let reply: JsonRpcResponse<McpToolCallResult> | null;
    try {
      reply = await postJsonRpc<McpToolCallResult>(
        record.serverUrl,
        {
          jsonrpc: "2.0",
          id: nextJsonRpcId(),
          method: "tools/call",
          params: {
            name: tool.remoteName,
            arguments: cleanMcpCallArgs(args, remoteProperties),
          },
        },
        record.auth,
        true
      );
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e);
      return { ok: false, error: enrichGoogleMcpProbeError(record.serverUrl, `transport error: ${raw}`) };
    }
    if (!reply) return { ok: false, error: "no response" };
    if (reply.error) return { ok: false, error: `MCP error ${reply.error.code}: ${reply.error.message}` };
    const result = reply.result ?? {};
    const parts = (result.content ?? [])
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean);
    const text = parts.join("\n").trim() || "[empty MCP response]";
    if (result.isError) {
      return { ok: false, error: enrichGoogleMcpProbeError(record.serverUrl, text) };
    }
    return { ok: true, output: text };
  };
}

function buildMcpTool(record: McpConnectionRecord, tool: McpToolRecord): ToolDefinition {
  const { properties: rawProperties, required } = ensureToolParameterShape(tool.inputSchema);
  const properties = expandMcpToolProperties(rawProperties);
  const remoteProperties = rawProperties as Record<string, unknown>;
  const isWrite = isMcpWriteTool(tool.remoteName, tool.description);
  const isRead = isMcpReadTool(tool.remoteName, tool.description);
  let description = enrichGoogleMcpToolDescription(
    record.name,
    tool.remoteName,
    `[mcp:${record.name}] ${tool.description || tool.remoteName}`
  );
  let handler = buildMcpToolHandler(record, tool, remoteProperties);
  if (record.name === "google_gmail" && tool.remoteName === "create_draft") {
    description +=
      " — PLAIN body only. For outbound mail, compose formatted body_html + body in gmail_create_draft before calling any draft tool.";
    const inner = handler;
    handler = async (args) => {
      const styleErr = validateOutboundEmailStyle(args);
      if (styleErr) return { ok: false, error: styleErr };
      return inner(args);
    };
  }
  return defineTool({
    name: tool.toolName,
    description,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    },
    requiresApproval: isWrite,
    dangerLevel: isWrite ? "destructive" : "safe",
    cacheable: isRead && !isWrite,
    cacheTtlMs: isRead ? 30_000 : undefined,
    handler,
  });
}

export function assignMcpToolNames(tools: McpToolRecord[], connName: string): void {
  for (const t of tools) {
    const slug = t.remoteName.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
    t.toolName = `mcp_${connName}_${slug}`.slice(0, 64);
  }
}

export function registerMcpConnection(registry: ToolRegistry, record: McpConnectionRecord): string[] {
  const registered: string[] = [];
  for (const t of record.tools) {
    if (registry.has(t.toolName)) registry.unregister(t.toolName);
    registry.register(buildMcpTool(record, t));
    registered.push(t.toolName);
  }
  registerConnectorToolFamilies(registry, record.name, registered, record.parentProvider);
  return registered;
}

export function unregisterMcpConnection(registry: ToolRegistry, record: McpConnectionRecord): number {
  let count = 0;
  for (const t of record.tools) {
    if (registry.unregister(t.toolName)) count++;
  }
  return count;
}

function parseAuthArg(auth: unknown): AuthScheme {
  if (!auth || typeof auth !== "object") return { kind: "none" };
  const a = auth as {
    kind?: string;
    envVar?: string;
    headerName?: string;
    provider?: string;
    accountId?: string;
    scopes?: string[];
  };
  if (a.kind === "oauth2" && a.provider === "google") {
    return {
      kind: "oauth2",
      provider: "google",
      accountId: a.accountId,
      scopes: Array.isArray(a.scopes) ? a.scopes : [],
    };
  }
  if (a.kind === "oauth2" && a.provider === "microsoft") {
    return {
      kind: "oauth2",
      provider: "microsoft",
      accountId: a.accountId,
      scopes: Array.isArray(a.scopes) ? a.scopes : [],
    };
  }
  if (a.kind === "oauth2" && a.provider === "github") {
    return {
      kind: "oauth2",
      provider: "github",
      accountId: a.accountId,
      scopes: Array.isArray(a.scopes) ? a.scopes : [],
    };
  }
  if (a.kind === "bearer" && a.envVar) return { kind: "bearer", envVar: a.envVar };
  if (a.kind === "header" && a.envVar && a.headerName) {
    return { kind: "header", headerName: a.headerName, envVar: a.envVar };
  }
  if (a.kind === "basic" && a.envVar) return { kind: "basic", envVar: a.envVar };
  return { kind: "none" };
}

/**
 * Under AGENT_TOOL_LAZY=1, MCP integrations register tools but stay off the model API
 * until activate_tool_family("<integration>") e.g. google_workspace, github, slack, or connector:<name> for custom MCP. Set
 * AGENT_INTEGRATION_AUTO_ACTIVATE=1 to restore eager activation (old behavior).
 */
export function resolveMcpAutoActivate(
  registry: ToolRegistry,
  opts?: { explicit?: boolean; fromRestore?: boolean }
): boolean {
  const explicit = opts?.explicit;
  if (!registry.isLazyToolLoading()) return explicit !== false;
  if (effectiveHarnessEnvRaw("AGENT_INTEGRATION_AUTO_ACTIVATE") === "1") {
    return explicit !== false;
  }
  // Ignore persisted autoActivate:true from older builds on harness restart.
  if (opts?.fromRestore) return false;
  return explicit === true;
}

export interface AttachMcpOptions {
  name: string;
  url: string;
  auth?: AuthScheme;
  readOnly?: boolean;
  autoActivate?: boolean;
  toolFilter?: McpToolFilter;
  providerId?: string;
  parentProvider?: string;
  services?: string[];
  oauthAccountId?: string;
  sidecarManaged?: boolean;
}

export async function attachMcpConnection(
  registry: ToolRegistry,
  opts: AttachMcpOptions
): Promise<{ record: McpConnectionRecord; registered: string[] }> {
  const name = sanitizeConnectionName(opts.name);
  if (!name) throw new Error("connection name normalized to empty");

  const existing = await readConnection(name);
  if (existing && existing.kind === "mcp") {
    unregisterMcpConnection(registry, existing);
  }

  const auth = opts.auth ?? { kind: "none" };
  let tools: McpToolRecord[];
  try {
    tools = await mcpHandshakeAndListTools(opts.url, auth);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    throw new Error(enrichGoogleMcpProbeError(opts.url, raw));
  }
  tools = filterMcpToolRecords(tools, {
    readOnly: opts.readOnly,
    toolFilter: opts.toolFilter,
  });
  if (tools.length === 0) throw new Error("no tools after filter");

  assignMcpToolNames(tools, name);

  const autoActivate = resolveMcpAutoActivate(registry, { explicit: opts.autoActivate });

  const record: McpConnectionRecord = {
    kind: "mcp",
    name,
    serverUrl: opts.url,
    transport: "http",
    auth,
    tools,
    attachedAt: Date.now(),
    readOnly: opts.readOnly,
    autoActivate,
    toolFilter: opts.toolFilter,
    providerId: opts.providerId,
    parentProvider: opts.parentProvider,
    services: opts.services,
    oauthAccountId: opts.oauthAccountId,
    sidecarManaged: opts.sidecarManaged,
  };

  await writeConnection(record);
  const registered = registerMcpConnection(registry, record);

  if (autoActivate) {
    registry.activate(registered);
  }

  return { record, registered };
}

export function createMcpAttachTools(registry: ToolRegistry, _emitter: AgentEmitter) {
  const mcpAttachTool = defineTool({
    name: "mcp_attach",
    description:
      "WHAT: Connect to a remote MCP server and register every tool it exposes.\n" +
      "WHEN: Plug into MCP-speaking services (GitHub, Slack, Google via connect_provider, custom servers).\n" +
      "HOW: Provide `name` and `url`. Generated tools: `mcp_<name>_*`. Persists across restarts.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short id, e.g. 'gh'." },
        url: { type: "string", description: "Streamable HTTP MCP endpoint." },
        auth: { type: "object", description: "Auth scheme (bearer/header/oauth2/none)." },
        read_only: { type: "boolean", description: "Skip write tools." },
        auto_activate: {
          type: "boolean",
          description:
            "Expose tools immediately. Under AGENT_TOOL_LAZY=1 defaults to false unless AGENT_INTEGRATION_AUTO_ACTIVATE=1.",
        },
      },
      required: ["name", "url"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      const rawName = String(args["name"] ?? "").trim();
      const url = String(args["url"] ?? "").trim();
      if (!rawName || !url) return { ok: false, error: "name and url are required" };

      try {
        const { record, registered } = await attachMcpConnection(registry, {
          name: rawName,
          url,
          auth: parseAuthArg(args["auth"]),
          readOnly: args["read_only"] === true,
          autoActivate: args["auto_activate"] === true,
        });
        const sample = record.tools.slice(0, 8).map((t) => `  ${t.toolName}  → ${t.remoteName}`).join("\n");
        const more = record.tools.length > 8 ? `\n  …and ${record.tools.length - 8} more` : "";
        return {
          ok: true,
          output:
            `Attached MCP '${record.name}'. URL: ${url}\n` +
            `Registered ${registered.length} tools:\n${sample}${more}\n` +
            `Auth: ${record.auth.kind}.\nPersisted to ~/.liminal/api_connections/${record.name}.json.`,
        };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    },
  });

  const mcpDetachTool = defineTool({
    name: "mcp_detach",
    description: "Unregister every tool from a named MCP connection and delete its persisted record.",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      const name = sanitizeConnectionName(String(args["name"] ?? ""));
      const record = await readConnection(name);
      if (!record || record.kind !== "mcp") {
        return { ok: false, error: `no MCP connection named '${name}'` };
      }
      const removed = unregisterMcpConnection(registry, record);
      await deleteConnection(name);
      return { ok: true, output: `Detached MCP '${name}'. Unregistered ${removed} tools.` };
    },
  });

  return { mcpAttachTool, mcpDetachTool };
}

export function restoreMcpConnectionsFromRecords(
  records: McpConnectionRecord[],
  registry: ToolRegistry
): { toolCount: number; activated: string[] } {
  let toolCount = 0;
  const activated: string[] = [];
  for (const c of records) {
    const names = registerMcpConnection(registry, c);
    toolCount += names.length;
    if (resolveMcpAutoActivate(registry, { explicit: c.autoActivate, fromRestore: true })) {
      activated.push(...registry.activate(names));
    }
  }
  return { toolCount, activated };
}

export async function restoreMcpConnections(
  registry: ToolRegistry,
  emitter: AgentEmitter
): Promise<number> {
  const all = await listConnections();
  const mcp = all.filter((c): c is McpConnectionRecord => c.kind === "mcp");
  try {
    return restoreMcpConnectionsFromRecords(mcp, registry).toolCount;
  } catch (e) {
    emitter.emit("error", {
      err: new Error(`Failed to restore MCP connections: ${e instanceof Error ? e.message : String(e)}`),
    });
    return 0;
  }
}

export { googleOAuthAuthScheme };
