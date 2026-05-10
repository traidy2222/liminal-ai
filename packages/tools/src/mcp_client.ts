/**
 * McpClientManager — connects to MCP (Model Context Protocol) servers
 * and bridges their tools into the Liminal harness.
 *
 * Uses lazy dynamic imports so the SDK is optional at compile time;
 * failing to load the SDK returns a clear "SDK not installed" error.
 *
 * Supports three transports:
 *   stdio  — local child process (most common)
 *   sse    — legacy SSE HTTP endpoint
 *   http   — StreamableHTTP endpoint (MCP SDK >=1.5)
 *
 * Config via AGENT_MCP_SERVERS env var (JSON):
 *   Array:         [{"name":"fs","command":"npx","args":[...]}, {"name":"api","url":"http://..."}]
 *   Claude Desktop: {"mcpServers":{"fs":{"command":"npx","args":[...]}}}
 */
import type { ToolResult } from "@liminal/core";

// ── Config types ──────────────────────────────────────────────────────────────

export interface StdioServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SseServerConfig {
  name: string;
  url: string;
  headers?: Record<string, string>;
}

export interface HttpServerConfig {
  name: string;
  http_url: string;
  headers?: Record<string, string>;
}

export type McpServerConfig = StdioServerConfig | SseServerConfig | HttpServerConfig;

export function isStdioConfig(c: McpServerConfig): c is StdioServerConfig {
  return "command" in c;
}
export function isSseConfig(c: McpServerConfig): c is SseServerConfig {
  return "url" in c && !("http_url" in c);
}
export function isHttpConfig(c: McpServerConfig): c is HttpServerConfig {
  return "http_url" in c;
}

// ── Internal SDK shim types (matching @modelcontextprotocol/sdk public API) ──

interface SdkTool {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

interface SdkCallResult {
  content?: Array<{
    type: string;
    text?: string;
    data?: string;
    mimeType?: string;
    resource?: { uri?: string; text?: string };
  }>;
  isError?: boolean;
}

interface SdkClient {
  connect(transport: unknown): Promise<void>;
  listTools(params?: Record<string, unknown>): Promise<{ tools: SdkTool[] }>;
  callTool(params: { name: string; arguments?: Record<string, unknown> }): Promise<SdkCallResult>;
  close(): Promise<void>;
}

interface SdkClientConstructor {
  new (
    info: { name: string; version: string },
    opts?: { capabilities?: Record<string, unknown> }
  ): SdkClient;
}

// ── Lazy SDK loader ───────────────────────────────────────────────────────────

interface LoadedSdk {
  Client: SdkClientConstructor;
  StdioClientTransport: new (opts: { command: string; args?: string[]; env?: NodeJS.ProcessEnv }) => unknown;
  SSEClientTransport: new (url: URL) => unknown;
}

let _sdk: LoadedSdk | null = null;
let _sdkLoadAttempted = false;

async function loadSdk(): Promise<LoadedSdk> {
  if (_sdk) return _sdk;
  if (_sdkLoadAttempted) {
    throw new Error(
      "@modelcontextprotocol/sdk is not installed. Run: npm install @modelcontextprotocol/sdk"
    );
  }
  _sdkLoadAttempted = true;
  try {
    const [clientMod, stdioMod, sseMod] = await Promise.all([
      import("@modelcontextprotocol/sdk/client/index.js"),
      import("@modelcontextprotocol/sdk/client/stdio.js"),
      import("@modelcontextprotocol/sdk/client/sse.js"),
    ]);
    _sdk = {
      Client: clientMod.Client as unknown as SdkClientConstructor,
      StdioClientTransport: stdioMod.StdioClientTransport as unknown as LoadedSdk["StdioClientTransport"],
      SSEClientTransport: sseMod.SSEClientTransport as unknown as LoadedSdk["SSEClientTransport"],
    };
    return _sdk;
  } catch (e) {
    _sdkLoadAttempted = false; // allow retry after install
    throw new Error(
      `Failed to load @modelcontextprotocol/sdk: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface McpTool {
  name: string;
  description: string;
  inputSchema: object;
}

export interface ConnectedServer {
  name: string;
  config: McpServerConfig;
  client: SdkClient;
  tools: McpTool[];
  /** Full harness-visible tool IDs: mcp__serverName__toolName */
  toolNames: string[];
}

// ── Result extraction ─────────────────────────────────────────────────────────

function extractMcpResult(result: SdkCallResult): ToolResult {
  if (result.isError) {
    const errText = (result.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    return { ok: false, error: errText || "MCP tool returned isError=true" };
  }

  const parts: string[] = [];
  for (const block of result.content ?? []) {
    switch (block.type) {
      case "text":
        if (block.text) parts.push(block.text);
        break;
      case "image":
        parts.push(`[Image: ${block.mimeType ?? "image/unknown"}, base64 data omitted]`);
        break;
      case "resource":
        if (block.resource?.text) parts.push(block.resource.text);
        else if (block.resource?.uri) parts.push(`[Resource: ${block.resource.uri}]`);
        break;
      default:
        parts.push(`[${block.type} content]`);
    }
  }

  return { ok: true, output: parts.join("\n") || "(empty response)" };
}

// ── Name helpers ──────────────────────────────────────────────────────────────

/** Sanitize server name for use in tool IDs (no special chars). */
export function sanitizeServerName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, "_").toLowerCase();
}

/** Full harness tool ID for an MCP tool: mcp__server__tool */
export function mcpToolId(serverName: string, toolName: string): string {
  return `mcp__${sanitizeServerName(serverName)}__${toolName}`;
}

// ── McpClientManager ──────────────────────────────────────────────────────────

export class McpClientManager {
  private servers = new Map<string, ConnectedServer>();

  async connect(config: McpServerConfig): Promise<{ toolNames: string[]; tools: McpTool[] }> {
    const { name } = config;
    if (this.servers.has(name)) {
      throw new Error(`MCP server "${name}" is already connected — disconnect it first.`);
    }

    const sdk = await loadSdk();
    const client = new sdk.Client({ name: "liminal-agent", version: "1.0.0" }, { capabilities: {} });

    let transport: unknown;
    if (isStdioConfig(config)) {
      transport = new sdk.StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: config.env
          ? ({ ...process.env, ...config.env } as NodeJS.ProcessEnv)
          : (process.env as NodeJS.ProcessEnv),
      });
    } else if (isSseConfig(config)) {
      transport = new sdk.SSEClientTransport(new URL(config.url));
    } else if (isHttpConfig(config)) {
      // Try StreamableHTTP (SDK >=1.5), fall back to SSE
      try {
        const httpMod = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
        const StreamableHTTP = httpMod.StreamableHTTPClientTransport as new (url: URL) => unknown;
        transport = new StreamableHTTP(new URL(config.http_url));
      } catch {
        transport = new sdk.SSEClientTransport(new URL(config.http_url));
      }
    } else {
      throw new Error("Invalid config: must have command, url, or http_url.");
    }

    await client.connect(transport);

    const { tools: rawTools } = await client.listTools({});
    const tools: McpTool[] = (rawTools ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as object | null | undefined) ?? {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
    }));

    const toolNames = tools.map((t) => mcpToolId(name, t.name));
    this.servers.set(name, { name, config, client, tools, toolNames });
    return { toolNames, tools };
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const server = this.servers.get(serverName);
    if (!server) {
      return { ok: false, error: `MCP server "${serverName}" is not connected. Use mcp_servers to list active connections.` };
    }
    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });
      return extractMcpResult(result);
    } catch (e) {
      return { ok: false, error: `MCP call failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  getServer(name: string): ConnectedServer | undefined {
    return this.servers.get(name);
  }

  listServers(): Array<{ name: string; transport: string; toolCount: number; toolNames: string[] }> {
    return [...this.servers.values()].map((s) => ({
      name: s.name,
      transport: isStdioConfig(s.config) ? "stdio" : isSseConfig(s.config) ? "sse" : "http",
      toolCount: s.tools.length,
      toolNames: s.toolNames,
    }));
  }

  async disconnect(name: string): Promise<void> {
    const server = this.servers.get(name);
    if (!server) throw new Error(`MCP server "${name}" is not connected.`);
    try { await server.client.close(); } catch { /* ignore close errors */ }
    this.servers.delete(name);
  }

  async disconnectAll(): Promise<void> {
    for (const [name] of this.servers) {
      try { await this.disconnect(name); } catch { /* ignore */ }
    }
  }
}

// ── Config parsing ────────────────────────────────────────────────────────────

/**
 * Parse AGENT_MCP_SERVERS env var.
 * Array format: [{name, command?, args?, env?, url?, http_url?}, ...]
 * Claude Desktop: {mcpServers: {name: {command, args?, env?}}}
 */
export function parseEnvMcpServers(): McpServerConfig[] {
  const raw = process.env["AGENT_MCP_SERVERS"]?.trim();
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[MCP] AGENT_MCP_SERVERS is not valid JSON — skipping auto-connect");
    return [];
  }

  if (Array.isArray(parsed)) {
    return parsed as McpServerConfig[];
  }

  if (parsed && typeof parsed === "object" && "mcpServers" in parsed) {
    const mcpServers = (parsed as { mcpServers: Record<string, { command?: string; args?: string[]; env?: Record<string, string>; url?: string; http_url?: string }> }).mcpServers;
    return Object.entries(mcpServers).map(([name, cfg]) => {
      if (cfg.http_url) return { name, http_url: cfg.http_url } satisfies HttpServerConfig;
      if (cfg.url) return { name, url: cfg.url } satisfies SseServerConfig;
      return { name, command: cfg.command!, args: cfg.args, env: cfg.env } satisfies StdioServerConfig;
    });
  }

  console.warn("[MCP] AGENT_MCP_SERVERS format not recognized — use array or Claude Desktop format");
  return [];
}

/** Module-level singleton shared across all callers. */
export const mcpManager = new McpClientManager();
