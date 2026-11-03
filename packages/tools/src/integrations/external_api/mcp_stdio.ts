import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport, getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { globalPath, type ToolExecutionContext } from "@liminal/core";
import type { McpStdioOptions, McpToolRecord } from "./api_connections_store.js";

type Session = { client: Client; transport: StdioClientTransport; name: string; tools: McpToolRecord[]; instructions?: string };
const scopes = new WeakMap<object, Map<string, Promise<Session>>>();
const sessions = new Set<Session>();
const fallbackScope = {};

function environment(config: McpStdioOptions): Record<string, string> {
  const env = getDefaultEnvironment();
  for (const [name, reference] of Object.entries(config.envRefs ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof reference !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(reference)) throw new Error("MCP environment references must be variable names");
    const value = process.env[reference];
    if (value === undefined) throw new Error(`MCP environment variable is not set: ${reference}`);
    env[name] = value;
  }
  for (const [name, value] of Object.entries(config.envPaths ?? {})) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || typeof value !== "string" || !path.isAbsolute(value) || !existsSync(value)) throw new Error(`MCP configuration path must exist and be absolute: ${name}`);
    env[name] = value;
  }
  return env;
}

async function start(name: string, config: McpStdioOptions, signal?: AbortSignal): Promise<Session> {
  if (typeof config.command !== "string" || !config.command.trim() || !Array.isArray(config.args ?? []) || (config.args ?? []).some(arg => typeof arg !== "string")) throw new Error("A local MCP command and string argument array are required");
  const cwd = globalPath("sidecars", "mcp", name.replace(/[^a-z0-9_-]/gi, "_"));
  await mkdir(cwd, { recursive: true });
  const transport = new StdioClientTransport({
    command: config.command, args: config.args, env: environment(config), cwd,
    stderr: "pipe", maxBufferSize: 16 * 1024 * 1024,
  });
  transport.stderr?.on("data", () => { /* drain diagnostics without exposing credentials */ });
  const client = new Client({ name: "liminal", version: "0.1.15" });
  const session: Session = { client, transport, name, tools: [] };
  sessions.add(session);
  const originalClose = client.onclose;
  client.onclose = () => { sessions.delete(session); originalClose?.(); };
  try {
    await client.connect(transport, { timeout: 30_000, signal });
    const listed = await client.listTools(undefined, { timeout: 60_000, signal });
    session.instructions = client.getInstructions();
    session.tools = listed.tools.map(tool => ({
        toolName: "", remoteName: tool.name, description: tool.description ?? "",
        inputSchema: tool.inputSchema as Record<string, unknown>,
        outputSchema: tool.outputSchema as Record<string, unknown> | undefined,
        annotations: tool.annotations,
      }));
    return session;
  } catch (error) {
    sessions.delete(session);
    await client.close().catch(() => undefined);
    throw error;
  }
}

export async function discoverStdioMcp(name: string, config: McpStdioOptions) {
  const session = await start(name, config);
  try { return { tools: session.tools, instructions: session.instructions }; }
  finally { await session.client.close(); }
}

async function sessionFor(name: string, config: McpStdioOptions, context?: ToolExecutionContext): Promise<Session> {
  const scope = context?.scope ?? fallbackScope;
  let connections = scopes.get(scope);
  if (!connections) { connections = new Map(); scopes.set(scope, connections); }
  const key = name + ":" + createHash("sha256").update(JSON.stringify(config)).digest("hex");
  const existing = connections.get(key);
  if (existing) {
    const session = await existing;
    if (sessions.has(session)) return session;
    connections.delete(key);
  }
  const pending = start(name, config, context?.signal);
  connections.set(key, pending);
  try { return await pending; }
  catch (error) { if (connections.get(key) === pending) connections.delete(key); throw error; }
}

export async function callStdioMcp(
  name: string, config: McpStdioOptions, tool: string, args: Record<string, unknown>,
  context?: ToolExecutionContext, emit?: (text: string) => void,
  onInstructions?: (instructions: string | undefined) => void,
) {
  const session = await sessionFor(name, config, context);
  try { onInstructions?.(session.instructions); } catch { /* Optional metadata must not fail or replay a native call. */ }
  // Never replay a failed call automatically: it may already have changed a target.
  return session.client.callTool({ name: tool, arguments: args }, {
    timeout: 1_800_000, signal: context?.signal,
    onprogress: progress => { if (progress.message) emit?.(progress.message); },
  });
}

export async function closeStdioMcp(name?: string, scope?: object): Promise<void> {
  if (scope) {
    const connections = scopes.get(scope);
    if (!connections) return;
    for (const [key, pending] of connections) {
      const session = await pending.catch(() => undefined);
      if (session && (!name || session.name === name)) { connections.delete(key); await session.client.close(); }
    }
    return;
  }
  await Promise.allSettled([...sessions].filter(s => !name || s.name === name).map(s => s.client.close()));
}
