/**
 * MCP (Model Context Protocol) attach — register a remote MCP server's tools
 * as local harness tools.
 *
 * Transport: Streamable HTTP only (POST JSON-RPC, optional SSE response). This
 * is the modern MCP transport and avoids spawning subprocesses. stdio servers
 * can still be reached by fronting them with an HTTP shim; we keep the wire
 * surface tight so the connection record stays JSON-serializable.
 *
 * Handshake (per MCP spec):
 *   1. POST `{"jsonrpc":"2.0","id":1,"method":"initialize", params:{protocolVersion,capabilities,clientInfo}}`
 *   2. POST `{"jsonrpc":"2.0","method":"notifications/initialized"}` (no response)
 *   3. POST `{"jsonrpc":"2.0","id":2,"method":"tools/list"}` → tools enumeration
 *
 * At call time each generated tool POSTs `tools/call` with `{name, arguments}`
 * and surfaces the `content[].text` join as the tool output.
 */
import type { AgentEmitter, ToolDefinition, ToolRegistry, ToolResult, PropertySchema } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  type AuthScheme,
  type McpConnectionRecord,
  type McpToolRecord,
  deleteConnection,
  listConnections,
  readConnection,
  resolveAuthHeader,
  sanitizeConnectionName,
  writeConnection,
} from "./api_connections_store.js";

const MCP_PROTOCOL_VERSION = "2025-06-18";
const MCP_CLIENT_INFO = { name: "liminal-harness", version: "0.1.0" };

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
    ...resolveAuthHeader(auth),
  };
  const res = await fetch(serverUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!expectReply) return null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("text/event-stream")) {
    // Drain SSE → return the first `data:` line that contains a JSON-RPC response.
    const text = await res.text();
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as JsonRpcResponse<T>;
        if (parsed && parsed.jsonrpc === "2.0") return parsed;
      } catch {
        /* continue scanning lines */
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

async function mcpHandshakeAndListTools(serverUrl: string, auth: AuthScheme): Promise<McpToolRecord[]> {
  // 1. initialize
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
  // 2. notifications/initialized — fire-and-forget per spec.
  try {
    await postJsonRpc(
      serverUrl,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      auth,
      false
    );
  } catch {
    /* not every server requires this; tolerate failure */
  }
  // 3. tools/list
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

function buildMcpToolHandler(record: McpConnectionRecord, tool: McpToolRecord): ToolDefinition["handler"] {
  return async (args): Promise<ToolResult> => {
    let reply: JsonRpcResponse<McpToolCallResult> | null;
    try {
      reply = await postJsonRpc<McpToolCallResult>(
        record.serverUrl,
        {
          jsonrpc: "2.0",
          id: nextJsonRpcId(),
          method: "tools/call",
          params: { name: tool.remoteName, arguments: args },
        },
        record.auth,
        true
      );
    } catch (e) {
      return { ok: false, error: `transport error: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!reply) return { ok: false, error: "no response" };
    if (reply.error) return { ok: false, error: `MCP error ${reply.error.code}: ${reply.error.message}` };
    const result = reply.result ?? {};
    const parts = (result.content ?? [])
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .filter(Boolean);
    const text = parts.join("\n").trim() || "[empty MCP response]";
    if (result.isError) return { ok: false, error: text };
    return { ok: true, output: text };
  };
}

function buildMcpTool(record: McpConnectionRecord, tool: McpToolRecord): ToolDefinition {
  const { properties, required } = ensureToolParameterShape(tool.inputSchema);
  return defineTool({
    name: tool.toolName,
    description: `[mcp:${record.name}] ${tool.description || tool.remoteName}`,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
    },
    // MCP tools span the full safety spectrum; default to approval-required so a
    // server marketed as "read-only" can't surprise the user with a write call.
    requiresApproval: true,
    dangerLevel: "cautious",
    handler: buildMcpToolHandler(record, tool),
  });
}

export function registerMcpConnection(registry: ToolRegistry, record: McpConnectionRecord): number {
  let count = 0;
  for (const t of record.tools) {
    if (registry.has(t.toolName)) registry.unregister(t.toolName);
    registry.register(buildMcpTool(record, t));
    count++;
  }
  return count;
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
  const a = auth as { kind?: string; envVar?: string; headerName?: string };
  if (a.kind === "bearer" && a.envVar) return { kind: "bearer", envVar: a.envVar };
  if (a.kind === "header" && a.envVar && a.headerName) return { kind: "header", headerName: a.headerName, envVar: a.envVar };
  if (a.kind === "basic" && a.envVar) return { kind: "basic", envVar: a.envVar };
  return { kind: "none" };
}

export function createMcpAttachTools(registry: ToolRegistry, _emitter: AgentEmitter) {
  const mcpAttachTool = defineTool({
    name: "mcp_attach",
    description:
      "WHAT: Connect to a remote MCP (Model Context Protocol) server and register every tool it exposes.\n" +
      "WHEN: You want to plug the agent into an MCP-speaking service (file-system bridges, GitHub, Slack, custom internal MCP servers).\n" +
      "HOW: Provide a connection `name` and the server's HTTP endpoint `url`. Handshake (`initialize` → `tools/list`) " +
      "runs immediately; generated tools land as `mcp_<name>_<remoteName>`. Survives restarts.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Short id, e.g. 'gh'. Becomes the tool prefix `mcp_<name>_*`." },
        url: {
          type: "string",
          description: "Streamable HTTP endpoint of the MCP server (commonly ending in `/mcp` or `/sse`).",
        },
        auth: {
          type: "object",
          description: "Optional auth scheme, same shape as api_connect (bearer/header/basic/none).",
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
      const name = sanitizeConnectionName(rawName);
      if (!name) return { ok: false, error: "name normalized to empty — use lowercase letters, digits, underscore" };

      const existing = await readConnection(name);
      if (existing && existing.kind === "mcp") {
        unregisterMcpConnection(registry, existing);
      }

      const auth = parseAuthArg(args["auth"]);
      let tools: McpToolRecord[];
      try {
        tools = await mcpHandshakeAndListTools(url, auth);
      } catch (e) {
        return { ok: false, error: `handshake failed: ${e instanceof Error ? e.message : String(e)}` };
      }
      // Assign final tool names AFTER we know the connection name (so persistence is stable).
      for (const t of tools) {
        const slug = t.remoteName.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
        t.toolName = `mcp_${name}_${slug}`.slice(0, 64);
      }

      const record: McpConnectionRecord = {
        kind: "mcp",
        name,
        serverUrl: url,
        transport: "http",
        auth,
        tools,
        attachedAt: Date.now(),
      };
      await writeConnection(record);
      const registered = registerMcpConnection(registry, record);

      const sample = tools.slice(0, 8).map((t) => `  ${t.toolName}  → ${t.remoteName}`).join("\n");
      const more = tools.length > 8 ? `\n  …and ${tools.length - 8} more` : "";
      return {
        ok: true,
        output:
          `Attached MCP '${name}'. URL: ${url}\n` +
          `Registered ${registered} tools:\n${sample}${more}\n` +
          `Auth: ${auth.kind}.\nPersisted to ~/.liminal/api_connections/${name}.json.`,
      };
    },
  });

  const mcpDetachTool = defineTool({
    name: "mcp_detach",
    description:
      "WHAT: Unregister every tool from a named MCP connection and delete its persisted record.\n" +
      "WHEN: A server is decommissioned or you want to refresh tool definitions via a fresh attach.",
    parameters: {
      type: "object",
      properties: { name: { type: "string", description: "MCP connection name." } },
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

/** Restore every persisted MCP connection — uses cached tool list, does NOT re-handshake. */
export function restoreMcpConnectionsFromRecords(records: McpConnectionRecord[], registry: ToolRegistry): number {
  let total = 0;
  for (const c of records) {
    total += registerMcpConnection(registry, c);
  }
  return total;
}

export async function restoreMcpConnections(registry: ToolRegistry, emitter: AgentEmitter): Promise<number> {
  const all = await listConnections();
  const mcp = all.filter((c): c is McpConnectionRecord => c.kind === "mcp");
  try {
    return restoreMcpConnectionsFromRecords(mcp, registry);
  } catch (e) {
    emitter.emit("error", {
      err: new Error(`Failed to restore MCP connections: ${e instanceof Error ? e.message : String(e)}`),
    });
    return 0;
  }
}
