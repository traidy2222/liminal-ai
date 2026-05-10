/**
 * MCP bridge — connects McpClientManager to the Liminal ToolRegistry.
 *
 * Each MCP tool is wrapped into a native ToolDefinition named
 * mcp__serverName__toolName (double underscore, matches the MCP ecosystem
 * convention used by Claude Desktop and other MCP clients).
 *
 * Management tools exposed to the model:
 *   mcp_connect    — connect to a new MCP server mid-session
 *   mcp_servers    — list active connections + their tool names
 *   mcp_disconnect — close a connection and unregister its tools
 */
import type { ToolRegistry, AgentEmitter, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  McpClientManager,
  mcpManager,
  parseEnvMcpServers,
  mcpToolId,
  isStdioConfig,
  isSseConfig,
  type McpServerConfig,
  type McpTool,
} from "./mcp_client.js";
import {
  searchCatalog,
  gatherMcpEnvironmentSignals,
} from "./mcp_catalog.js";

// ── Bridge: MCP tool → ToolDefinition ────────────────────────────────────────

function bridgeMcpTool(
  serverName: string,
  mcpTool: McpTool,
  manager: McpClientManager
): ToolDefinition {
  const id = mcpToolId(serverName, mcpTool.name);

  const schema = mcpTool.inputSchema as {
    properties?: Record<string, unknown>;
    required?: string[];
  };

  return defineTool({
    name: id,
    description:
      `[MCP:${serverName}] ${mcpTool.description || mcpTool.name}\n` +
      `Server: ${serverName}  Tool: ${mcpTool.name}`,
    requiresApproval: false,
    parameters: {
      type: "object",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      properties: (schema.properties ?? {}) as Record<string, any>,
      required: schema.required,
      additionalProperties: false,
    },
    handler: async (args, emit): Promise<ToolResult> => {
      emit?.(`\n${id}: calling "${mcpTool.name}" on MCP server "${serverName}"…\n`);
      return manager.callTool(serverName, mcpTool.name, args);
    },
  });
}

// ── Connect + register all tools from one server ──────────────────────────────

export async function registerMcpServerTools(
  config: McpServerConfig,
  manager: McpClientManager,
  registry: ToolRegistry,
  _emitter: AgentEmitter
): Promise<{ registered: string[]; skipped: string[] }> {
  await manager.connect(config);

  const server = manager.getServer(config.name)!;
  const registered: string[] = [];
  const skipped: string[] = [];

  for (const mcpTool of server.tools) {
    const id = mcpToolId(config.name, mcpTool.name);
    if (registry.has(id)) {
      skipped.push(id);
      continue;
    }
    registry.register(bridgeMcpTool(config.name, mcpTool, manager));
    registered.push(id);
  }

  return { registered, skipped };
}

// ── Management tools ──────────────────────────────────────────────────────────

export function createMcpManagementTools(
  manager: McpClientManager,
  registry: ToolRegistry,
  emitter: AgentEmitter
) {
  const mcp_connect = defineTool({
    name: "mcp_connect",
    description:
      "WHAT: Connect to an MCP (Model Context Protocol) server and register all its tools.\n" +
      "WHEN: You need capabilities from an external MCP server — filesystem, GitHub, DB, browser, etc.\n" +
      "Provide ONE transport: command (stdio process), url (SSE endpoint), or http_url (StreamableHTTP).\n" +
      "After connecting, the server's tools are immediately callable as mcp__name__toolName.\n" +
      "ARGS: name (server label), command+args+env OR url OR http_url.",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Server label — used in tool names as mcp__label__toolName.",
        },
        command: {
          type: "string",
          description: "Executable for stdio transport (e.g. 'npx', 'python').",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Arguments for the stdio command.",
        },
        env: {
          type: "object",
          description: "Extra env vars injected into the stdio child process (key=value pairs).",
        },
        url: {
          type: "string",
          description: "SSE endpoint URL (e.g. 'http://localhost:8080/sse').",
        },
        http_url: {
          type: "string",
          description: "StreamableHTTP endpoint URL (newer MCP standard).",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: async (args, emit): Promise<ToolResult> => {
      const name = String(args["name"] ?? "").trim();
      if (!name) return { ok: false, error: "name is required." };

      emit?.(`\nmcp_connect: connecting to "${name}"…\n`);

      let config: McpServerConfig;
      if (args["command"]) {
        config = {
          name,
          command: String(args["command"]),
          args: (args["args"] as string[] | undefined) ?? [],
          env: args["env"] as Record<string, string> | undefined,
        };
      } else if (args["http_url"]) {
        config = { name, http_url: String(args["http_url"]) };
      } else if (args["url"]) {
        config = { name, url: String(args["url"]) };
      } else {
        return {
          ok: false,
          error: "Provide command (stdio), url (SSE), or http_url (StreamableHTTP).",
        };
      }

      try {
        const { registered, skipped } = await registerMcpServerTools(
          config,
          manager,
          registry,
          emitter
        );
        emit?.(`  ✓ registered ${registered.length} tool(s)\n`);
        return {
          ok: true,
          output:
            `Connected to MCP server "${name}".\n` +
            `Registered tools (${registered.length}):\n` +
            (registered.length > 0 ? registered.map((t) => `  • ${t}`).join("\n") : "  (none)") +
            (skipped.length > 0
              ? `\nSkipped (already registered): ${skipped.join(", ")}`
              : ""),
        };
      } catch (e) {
        return {
          ok: false,
          error: `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  });

  const mcp_servers = defineTool({
    name: "mcp_servers",
    description:
      "WHAT: List all currently connected MCP servers and their registered tool names.\n" +
      "WHEN: To inspect what MCP servers are active, or before disconnecting one.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (): Promise<ToolResult> => {
      const servers = manager.listServers();
      if (servers.length === 0) {
        return {
          ok: true,
          output:
            "No MCP servers connected.\n" +
            "• Use mcp_connect to connect to a server.\n" +
            "• Set AGENT_MCP_SERVERS env var to load on startup.",
        };
      }

      const lines = servers.map((s) => {
        const toolList =
          s.toolNames.length > 0
            ? "\n  Tools:\n" + s.toolNames.map((t) => `    • ${t}`).join("\n")
            : "\n  (no tools registered)";
        return `[${s.transport}] ${s.name} — ${s.toolCount} tool(s)${toolList}`;
      });

      return {
        ok: true,
        output: `Connected MCP servers (${servers.length}):\n\n` + lines.join("\n\n"),
      };
    },
  });

  const mcp_disconnect = defineTool({
    name: "mcp_disconnect",
    description:
      "WHAT: Disconnect from an MCP server and unregister all its tools from the harness.\n" +
      "WHEN: A server is no longer needed, needs reconfiguration, or is misbehaving.\n" +
      "ARGS: name — the server label used in mcp_connect.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Server name to disconnect." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: async (args): Promise<ToolResult> => {
      const name = String(args["name"] ?? "").trim();
      const server = manager.getServer(name);
      if (!server) {
        return {
          ok: false,
          error: `No connected MCP server "${name}". Use mcp_servers to list active connections.`,
        };
      }

      const count = server.toolNames.length;
      for (const toolId of server.toolNames) {
        registry.unregister(toolId);
      }

      try {
        await manager.disconnect(name);
      } catch (e) {
        return {
          ok: false,
          error: `Disconnect error: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      return {
        ok: true,
        output: `Disconnected from MCP server "${name}". Unregistered ${count} tool(s).`,
      };
    },
  });

  const mcp_suggest = defineTool({
    name: "mcp_suggest",
    description:
      "WHAT: Find the right MCP server for a capability gap — returns ranked candidates with ready-to-use mcp_connect calls.\n" +
      "WHEN: You need an external service (GitHub, database, browser, Slack, etc.) and no active tool covers it.\n" +
      "Call this BEFORE telling the user a capability is unavailable. If a server shows READY, connect it immediately.\n" +
      "ARGS: task — describe the capability you need in plain English.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Plain-English description of the capability needed (e.g. 'query GitHub pull requests', 'read a SQLite database', 'send a Slack message').",
        },
        show_all: {
          type: "boolean",
          description: "If true, show all catalog entries regardless of query match (useful for browsing).",
        },
      },
      required: ["task"],
      additionalProperties: false,
    },
    handler: async (args, emit): Promise<ToolResult> => {
      const task = String(args["task"] ?? "").trim();
      const showAll = Boolean(args["show_all"] ?? false);
      emit?.(`\nmcp_suggest: scanning catalog for "${task}"…\n`);

      const env = await gatherMcpEnvironmentSignals();
      const connectedIds = new Set(manager.listServers().map((s) => s.name));

      let results = searchCatalog(showAll ? "files github database browser search slack" : task, env, connectedIds);
      if (showAll) {
        // include everything not already connected
        for (const entry of (await import("./mcp_catalog.js")).MCP_CATALOG) {
          if (!connectedIds.has(entry.id) && !results.find((r) => r.entry.id === entry.id)) {
            results.push({ entry, score: 0, ready: entry.requiredEnvVars.length === 0, missing: entry.requiredEnvVars.filter((v) => !v.optional) });
          }
        }
      }

      if (results.length === 0) {
        return {
          ok: true,
          output:
            `No catalog entries match "${task}".\n` +
            "Use mcp_connect directly if you know the server package, or mcp_suggest(show_all=true) to browse all entries.",
        };
      }

      const top = results.slice(0, 6);
      const lines: string[] = [`Found ${results.length} MCP server(s) for "${task}":\n`];

      for (const { entry, ready, missing } of top) {
        const status = ready ? "✅ READY" : "🔑 NEEDS CREDENTIALS";
        lines.push(`${status} — ${entry.displayName} (${entry.npmPackage})`);
        lines.push(`   ${entry.description}`);

        if (ready) {
          lines.push(`   Connect now:`);
          lines.push(`     ${entry.connectExample}`);
          if (entry.argsNote) lines.push(`   Note: ${entry.argsNote}`);
        } else {
          lines.push(`   Missing credentials:`);
          for (const req of missing) {
            const alts = req.alternatives?.length ? ` (or ${req.alternatives.join(", ")})` : "";
            lines.push(`     • ${req.name}${alts} — ${req.description}`);
          }
          lines.push(`   After providing credentials, connect with:`);
          lines.push(`     ${entry.connectExample}`);
        }
        lines.push("");
      }

      if (results.length > top.length) {
        lines.push(`…and ${results.length - top.length} more. Use show_all=true to see all.`);
      }

      const readyCount = top.filter((r) => r.ready).length;
      if (readyCount > 0) {
        lines.push(`\n${readyCount} server(s) are READY — call mcp_connect now using the example above.`);
      }

      return { ok: true, output: lines.join("\n") };
    },
  });

  return { mcp_connect, mcp_servers, mcp_disconnect, mcp_suggest };
}

// ── Startup loader ────────────────────────────────────────────────────────────

/**
 * Load all servers declared in AGENT_MCP_SERVERS on harness startup.
 * Failures are logged as warnings — the harness continues without that server.
 */
export async function loadMcpServersFromEnv(
  registry: ToolRegistry,
  emitter: AgentEmitter
): Promise<void> {
  const configs = parseEnvMcpServers();
  if (configs.length === 0) return;

  for (const config of configs) {
    try {
      const { registered } = await registerMcpServerTools(config, mcpManager, registry, emitter);
      console.info(`[MCP] Connected "${config.name}" — ${registered.length} tool(s) registered`);
    } catch (e) {
      console.warn(
        `[MCP] Failed to connect "${config.name}": ${e instanceof Error ? e.message : String(e)}`
      );
    }
  }
}

export { mcpManager };
