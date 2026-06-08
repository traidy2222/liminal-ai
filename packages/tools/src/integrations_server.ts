/**
 * Server-side integration helpers for web Settings → Integrations UI.
 */
import type { AgentEmitter, ToolRegistry } from "@liminal/core";
import {
  deleteConnection,
  listConnections,
  readConnection,
  type AuthScheme,
  type ConnectionRecord,
} from "./api_connections_store.js";
import { attachMcpConnection, restoreMcpConnections, unregisterMcpConnection } from "./mcp_attach.js";
import {
  createApiConnectionTools,
  restoreOpenApiConnections,
  unregisterOpenApiConnection,
} from "./api_connect.js";

export interface IntegrationConnectionSummary {
  kind: "mcp" | "openapi";
  name: string;
  toolCount: number;
  sampleTools: string[];
  authKind: string;
  attachedAt: number;
  /** Curated provider (e.g. google_workspace) — hide from custom MCP form list. */
  parentProvider?: string;
  serverUrl?: string;
  specUrl?: string;
  baseUrl?: string;
  readOnly?: boolean;
  services?: string[];
}

function authKind(auth: AuthScheme): string {
  return auth.kind;
}

function summarizeConnection(c: ConnectionRecord): IntegrationConnectionSummary {
  if (c.kind === "openapi") {
    return {
      kind: "openapi",
      name: c.name,
      toolCount: c.operations.length,
      sampleTools: c.operations.slice(0, 6).map((o) => o.toolName),
      authKind: authKind(c.auth),
      attachedAt: c.attachedAt,
      specUrl: c.specUrl,
      baseUrl: c.baseUrl,
    };
  }
  return {
    kind: "mcp",
    name: c.name,
    toolCount: c.tools.length,
    sampleTools: c.tools.slice(0, 6).map((t) => t.toolName),
    authKind: authKind(c.auth),
    attachedAt: c.attachedAt,
    parentProvider: c.parentProvider,
    serverUrl: c.serverUrl,
    readOnly: c.readOnly,
    services: c.services,
  };
}

export async function listIntegrationConnections(): Promise<IntegrationConnectionSummary[]> {
  const all = await listConnections();
  return all.map(summarizeConnection);
}

function parseAuthBody(auth: unknown): AuthScheme {
  if (!auth || typeof auth !== "object") return { kind: "none" };
  const a = auth as { kind?: string; envVar?: string; headerName?: string };
  if (a.kind === "bearer" && a.envVar?.trim()) return { kind: "bearer", envVar: a.envVar.trim() };
  if (a.kind === "header" && a.envVar?.trim() && a.headerName?.trim()) {
    return { kind: "header", headerName: a.headerName.trim(), envVar: a.envVar.trim() };
  }
  if (a.kind === "basic" && a.envVar?.trim()) return { kind: "basic", envVar: a.envVar.trim() };
  return { kind: "none" };
}

export async function attachCustomMcpFromServer(
  registry: ToolRegistry,
  opts: {
    name: string;
    url: string;
    readOnly?: boolean;
    auth?: AuthScheme;
  }
): Promise<{ ok: boolean; output?: string; error?: string; toolNames?: string[] }> {
  try {
    const { record, registered } = await attachMcpConnection(registry, {
      name: opts.name,
      url: opts.url,
      auth: opts.auth ?? { kind: "none" },
      readOnly: opts.readOnly ?? false,
    });
    return {
      ok: true,
      output: `Attached MCP '${record.name}' — ${registered.length} tools.`,
      toolNames: registered,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function detachCustomMcpFromServer(
  registry: ToolRegistry,
  name: string
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const record = await readConnection(name);
  if (!record || record.kind !== "mcp") {
    return { ok: false, error: `no MCP connection named '${name}'` };
  }
  const removed = unregisterMcpConnection(registry, record);
  await deleteConnection(name);
  return { ok: true, output: `Detached MCP '${name}' (${removed} tools).` };
}

export async function connectOpenApiFromServer(
  registry: ToolRegistry,
  opts: {
    name: string;
    specUrl: string;
    baseUrl?: string;
    auth?: AuthScheme;
    autoApproveReads?: boolean;
  }
): Promise<{ ok: boolean; output?: string; error?: string; toolNames?: string[] }> {
  const { apiConnectTool } = createApiConnectionTools(registry, { emit: () => {} } as unknown as AgentEmitter);
  const result = await apiConnectTool.handler({
    name: opts.name,
    specUrl: opts.specUrl,
    baseUrl: opts.baseUrl,
    auth: opts.auth,
    autoApproveReads: opts.autoApproveReads !== false,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const record = await readConnection(opts.name);
  const toolNames =
    record?.kind === "openapi" ? record.operations.map((o) => o.toolName) : [];
  if (!registry.isLazyToolLoading() && toolNames.length > 0) {
    registry.activate(toolNames);
  }
  return { ok: true, output: result.output, toolNames };
}

export async function disconnectOpenApiFromServer(
  registry: ToolRegistry,
  name: string
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const record = await readConnection(name);
  if (!record || record.kind !== "openapi") {
    return { ok: false, error: `no OpenAPI connection named '${name}'` };
  }
  const removed = unregisterOpenApiConnection(registry, record);
  await deleteConnection(name);
  return { ok: true, output: `Disconnected OpenAPI '${name}' (${removed} tools).` };
}

/** Re-register persisted MCP/OpenAPI/Google tools after integration changes. */
export async function refreshIntegrationToolsOnRegistry(
  registry: ToolRegistry,
  emitter: AgentEmitter
): Promise<void> {
  await restoreOpenApiConnections(registry, emitter);
  const { bootstrapGoogleWorkspace } = await import("./google_workspace_boot.js");
  await bootstrapGoogleWorkspace(registry);
  await restoreMcpConnections(registry, emitter);
  const { bootstrapGithub } = await import("./github_boot.js");
  await bootstrapGithub(registry);
  const { bootstrapMicrosoft365 } = await import("./microsoft_365_boot.js");
  await bootstrapMicrosoft365(registry);
}

export { parseAuthBody };
