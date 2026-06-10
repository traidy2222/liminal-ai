/**
 * OpenAPI auto-import — fetch a spec, register each operation as a typed tool.
 *
 * Three tools land in the registry:
 *   - api_connect: fetch + parse + register; persists the connection so it
 *     survives restarts.
 *   - api_disconnect: unregister every tool from a named connection and delete
 *     the persisted record.
 *   - api_list: enumerate live connections + the tools each contributes.
 *
 * Generated tool naming: `api_<conn>_<opSlug>` — namespaced so two
 * connections (e.g. linear + notion) can both expose an `issues_create`
 * operation without collision. opSlug derives from operationId or
 * `<method>_<path-with-slashes-as-underscores>` when operationId is absent.
 *
 * Approval policy: GET operations honor the connection's autoApproveReads flag
 * (defaults to true) so reads don't require approval; POST/PUT/PATCH/DELETE
 * always require approval. This mirrors web_fetch (cacheable read) vs run_shell
 * (destructive).
 *
 * Spec ingest is best-effort: minor schema gaps don't fail the whole connect,
 * they just produce slightly looser parameter validation on that operation.
 */
import type {
  AgentEmitter,
  ToolDefinition,
  ToolRegistry,
  ToolResult,
  PropertySchema,
} from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  type AuthScheme,
  type OpenApiConnectionRecord,
  type OpenApiOperationRecord,
  deleteConnection,
  listConnections,
  readConnection,
  resolveAuthHeader,
  sanitizeConnectionName,
  writeConnection,
} from "./api_connections_store.js";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "options", "head"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

interface OpenApiParameter {
  name?: string;
  in?: string;
  required?: boolean;
  schema?: { type?: string; enum?: unknown[]; description?: string };
  description?: string;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    content?: Record<string, { schema?: Record<string, unknown> }>;
  };
}

interface OpenApiSpec {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  servers?: Array<{ url?: string }>;
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Partial<Record<HttpMethod | string, OpenApiOperation>>>;
}

function slugifyPath(pathTemplate: string): string {
  return pathTemplate
    .replace(/^\/+|\/+$/g, "")
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase()
    .slice(0, 60);
}

function deriveOperationToolName(connName: string, op: OpenApiOperation, method: string, pathTemplate: string): string {
  const slug = op.operationId
    ? op.operationId.replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase()
    : `${method}_${slugifyPath(pathTemplate)}`;
  return `api_${connName}_${slug}`.slice(0, 64);
}

function deriveBaseUrl(spec: OpenApiSpec, specUrl: string): string {
  const fromServers = spec.servers?.[0]?.url?.trim();
  if (fromServers) {
    try {
      // Resolve relative server URLs (e.g. "/v1") against the spec URL.
      return new URL(fromServers, specUrl).toString().replace(/\/+$/, "");
    } catch {
      return fromServers.replace(/\/+$/, "");
    }
  }
  // Swagger 2.0 fallback.
  if (spec.host) {
    const scheme = spec.schemes?.includes("https") ? "https" : spec.schemes?.[0] ?? "https";
    return `${scheme}://${spec.host}${spec.basePath ?? ""}`.replace(/\/+$/, "");
  }
  try {
    const u = new URL(specUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

function operationParameters(op: OpenApiOperation): OpenApiOperationRecord["parameters"] {
  const params = op.parameters ?? [];
  return params
    .filter((p) => p && p.name && (p.in === "path" || p.in === "query" || p.in === "header"))
    .map((p) => ({
      name: p.name as string,
      in: p.in as "path" | "query" | "header",
      required: Boolean(p.required) || p.in === "path",
      schema: {
        type: p.schema?.type,
        enum: p.schema?.enum,
        description: p.description ?? p.schema?.description,
      },
    }));
}

function operationRequestBody(op: OpenApiOperation): OpenApiOperationRecord["requestBody"] {
  const body = op.requestBody;
  if (!body || !body.content) return undefined;
  // Prefer application/json — the only content-type we currently serialize.
  const entries = Object.entries(body.content);
  const jsonEntry = entries.find(([ct]) => ct.toLowerCase().includes("json")) ?? entries[0];
  if (!jsonEntry) return undefined;
  const [contentType, def] = jsonEntry;
  return {
    required: Boolean(body.required),
    contentType,
    schema: def?.schema ?? null,
  };
}

function buildToolParameters(opRecord: OpenApiOperationRecord): {
  properties: Record<string, PropertySchema>;
  required: string[];
} {
  const properties: Record<string, PropertySchema> = {};
  const required: string[] = [];
  for (const p of opRecord.parameters) {
    properties[p.name] = {
      type: (p.schema.type as PropertySchema["type"]) ?? "string",
      description:
        p.schema.description ??
        `${p.in} parameter` + (p.required ? " (required)" : ""),
      ...(p.schema.enum ? { enum: p.schema.enum as PropertySchema["enum"] } : {}),
    };
    if (p.required) required.push(p.name);
  }
  if (opRecord.requestBody) {
    properties["body"] = {
      type: "object",
      description:
        `Request body (${opRecord.requestBody.contentType}). ` +
        (opRecord.requestBody.required ? "Required." : "Optional."),
    };
    if (opRecord.requestBody.required) required.push("body");
  }
  return { properties, required };
}

function applyTemplate(template: string, params: Record<string, unknown>): { url: string; usedKeys: Set<string> } {
  const usedKeys = new Set<string>();
  const url = template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    usedKeys.add(key);
    const raw = params[key];
    return encodeURIComponent(String(raw ?? ""));
  });
  return { url, usedKeys };
}

function buildOperationHandler(
  record: OpenApiConnectionRecord,
  op: OpenApiOperationRecord
): ToolDefinition["handler"] {
  return async (args) => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...resolveAuthHeader(record.auth),
    };

    const { url: filledPath, usedKeys } = applyTemplate(op.pathTemplate, args);
    const url = new URL(filledPath.replace(/^\/+/, ""), record.baseUrl.endsWith("/") ? record.baseUrl : record.baseUrl + "/");

    for (const p of op.parameters) {
      if (usedKeys.has(p.name)) continue;
      const v = args[p.name];
      if (v === undefined || v === null) continue;
      if (p.in === "query") url.searchParams.set(p.name, String(v));
      else if (p.in === "header") headers[p.name] = String(v);
    }

    let body: string | undefined;
    if (op.requestBody && args["body"] !== undefined) {
      headers["Content-Type"] = op.requestBody.contentType;
      body = JSON.stringify(args["body"]);
    }

    const init: RequestInit = { method: op.method.toUpperCase(), headers };
    if (body !== undefined) init.body = body;

    let res: Response;
    try {
      res = await fetch(url.toString(), init);
    } catch (e) {
      return { ok: false, error: `network error: ${e instanceof Error ? e.message : String(e)}` };
    }
    const text = await res.text();
    const status = `${res.status} ${res.statusText}`;
    const preview = text.length > 24_000 ? text.slice(0, 24_000) + `\n[...response truncated, ${text.length - 24_000} more chars]` : text;
    if (!res.ok) {
      return { ok: false, error: `HTTP ${status}\n${preview}` };
    }
    return { ok: true, output: `HTTP ${status}\n${preview}` };
  };
}

function isDestructiveMethod(method: string): boolean {
  const m = method.toLowerCase();
  return m === "post" || m === "put" || m === "patch" || m === "delete";
}

function buildOperationTool(record: OpenApiConnectionRecord, op: OpenApiOperationRecord): ToolDefinition {
  const { properties, required } = buildToolParameters(op);
  const reqApproval = isDestructiveMethod(op.method) || !record.autoApproveReads;
  return defineTool({
    name: op.toolName,
    description: `[${record.name}] ${op.method.toUpperCase()} ${op.pathTemplate}${op.summary ? " — " + op.summary : ""}`,
    parameters: {
      type: "object",
      properties,
      required: required.length > 0 ? required : undefined,
      additionalProperties: false,
    },
    requiresApproval: reqApproval,
    dangerLevel: isDestructiveMethod(op.method) ? "destructive" : "safe",
    handler: buildOperationHandler(record, op),
  });
}

/** Register every operation belonging to an OpenAPI connection record. */
export function registerOpenApiConnection(registry: ToolRegistry, record: OpenApiConnectionRecord): number {
  let count = 0;
  for (const op of record.operations) {
    if (registry.has(op.toolName)) registry.unregister(op.toolName);
    registry.register(buildOperationTool(record, op));
    count++;
  }
  return count;
}

/** Tear down every generated tool from a connection. */
export function unregisterOpenApiConnection(registry: ToolRegistry, record: OpenApiConnectionRecord): number {
  let count = 0;
  for (const op of record.operations) {
    if (registry.unregister(op.toolName)) count++;
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

async function fetchSpec(specUrl: string): Promise<OpenApiSpec> {
  const res = await fetch(specUrl, { headers: { Accept: "application/json, application/yaml;q=0.5, */*;q=0.1" } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching spec`);
  const text = await res.text();
  // JSON first; fail loudly if the spec is YAML — we don't ship a YAML parser.
  try {
    return JSON.parse(text) as OpenApiSpec;
  } catch {
    throw new Error(
      "spec is not JSON. Convert YAML→JSON (e.g. via Swagger editor's File → Convert and Save as JSON) and re-run api_connect."
    );
  }
}

export function __testing_specToOperations(spec: unknown, connName: string): OpenApiOperationRecord[] {
  return specToOperations(spec as OpenApiSpec, connName);
}
export function __testing_deriveBaseUrl(spec: unknown, specUrl: string): string {
  return deriveBaseUrl(spec as OpenApiSpec, specUrl);
}
function specToOperations(spec: OpenApiSpec, connName: string): OpenApiOperationRecord[] {
  const out: OpenApiOperationRecord[] = [];
  const paths = spec.paths ?? {};
  for (const [pathTemplate, methods] of Object.entries(paths)) {
    if (!methods || typeof methods !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = methods[method] as OpenApiOperation | undefined;
      if (!op) continue;
      const opId = op.operationId ?? `${method}_${pathTemplate}`;
      const toolName = deriveOperationToolName(connName, op, method, pathTemplate);
      out.push({
        toolName,
        operationId: opId,
        method,
        pathTemplate,
        summary: op.summary ?? op.description?.slice(0, 200),
        parameters: operationParameters(op),
        requestBody: operationRequestBody(op),
      });
    }
  }
  return out;
}

// ─── Public factory ──────────────────────────────────────────────────────────

export function createApiConnectionTools(registry: ToolRegistry, _emitter: AgentEmitter) {
  const apiConnectTool = defineTool({
    name: "api_connect",
    description:
      "WHAT: Fetch an OpenAPI/Swagger spec and register every operation as a typed, callable tool.\n" +
      "WHEN: User wants the agent to interact with an external HTTP API (Linear, Notion, internal SaaS, etc.) " +
      "without hand-coding a wrapper. The connection persists across restarts.\n" +
      "HOW: Provide a connection `name`, the spec `specUrl`, and an optional `auth` scheme that names an env var " +
      "for the secret (the secret itself is never stored). Generated tools land as `api_<name>_<operationId>`. " +
      "GET tools skip approval by default; POST/PUT/PATCH/DELETE always require approval.",
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Short connection id, lowercase, e.g. 'linear'. Becomes the tool prefix `api_<name>_*`.",
        },
        specUrl: {
          type: "string",
          description: "Public URL of the OpenAPI 3.x JSON spec. YAML specs are rejected with a conversion hint.",
        },
        baseUrl: {
          type: "string",
          description: "Optional override for the spec's `servers[0].url`. Use when the spec lists a placeholder URL.",
        },
        auth: {
          type: "object",
          description:
            "Auth scheme. Examples: { kind: 'bearer', envVar: 'LINEAR_TOKEN' }, " +
            "{ kind: 'header', headerName: 'X-Api-Key', envVar: 'NOTION_KEY' }, " +
            "{ kind: 'basic', envVar: 'BASIC_AUTH_B64' }, { kind: 'none' }.",
        },
        autoApproveReads: {
          type: "boolean",
          description: "If true (default), GET operations bypass the approval gate. Writes always require approval.",
        },
      },
      required: ["name", "specUrl"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      const rawName = String(args["name"] ?? "").trim();
      const specUrl = String(args["specUrl"] ?? "").trim();
      if (!rawName || !specUrl) return { ok: false, error: "name and specUrl are required" };
      const name = sanitizeConnectionName(rawName);
      if (!name) return { ok: false, error: "name normalized to empty — use lowercase letters, digits, underscore" };

      const existing = await readConnection(name);
      if (existing && existing.kind === "openapi") {
        // Drop the old operations before re-registering — the spec may have changed.
        unregisterOpenApiConnection(registry, existing);
      }

      let spec: OpenApiSpec;
      try {
        spec = await fetchSpec(specUrl);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
      if (!spec.openapi && !spec.swagger) {
        return { ok: false, error: "document does not look like an OpenAPI/Swagger spec (no openapi/swagger key)" };
      }

      const baseUrlOverride = typeof args["baseUrl"] === "string" ? String(args["baseUrl"]).trim() : "";
      const baseUrl = baseUrlOverride || deriveBaseUrl(spec, specUrl);
      if (!baseUrl) return { ok: false, error: "could not determine base URL — pass `baseUrl` explicitly" };

      const operations = specToOperations(spec, name);
      if (operations.length === 0) return { ok: false, error: "spec contained zero operations" };

      const record: OpenApiConnectionRecord = {
        kind: "openapi",
        name,
        specUrl,
        baseUrl,
        auth: parseAuthArg(args["auth"]),
        autoApproveReads: args["autoApproveReads"] !== false,
        operations,
        attachedAt: Date.now(),
      };
      await writeConnection(record);
      const registered = registerOpenApiConnection(registry, record);

      const sample = operations.slice(0, 8).map((o) => `  ${o.toolName}  (${o.method.toUpperCase()} ${o.pathTemplate})`).join("\n");
      const more = operations.length > 8 ? `\n  …and ${operations.length - 8} more` : "";
      return {
        ok: true,
        output:
          `Connected '${name}' (${spec.info?.title ?? "OpenAPI"}). Base: ${baseUrl}\n` +
          `Registered ${registered} tools:\n${sample}${more}\n` +
          `Auth: ${record.auth.kind}${record.auth.kind !== "none" ? ` (env $${(record.auth as { envVar: string }).envVar})` : ""}.\n` +
          `Persisted to ~/.liminal/api_connections/${name}.json — survives restart.`,
      };
    },
  });

  const apiDisconnectTool = defineTool({
    name: "api_disconnect",
    description:
      "WHAT: Unregister every tool from a named API connection and delete its persisted record.\n" +
      "WHEN: A connection is no longer needed, its spec has moved, or you want to refresh and reconnect from scratch.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Connection name passed to api_connect." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    requiresApproval: false,
    handler: async (args): Promise<ToolResult> => {
      const name = sanitizeConnectionName(String(args["name"] ?? ""));
      const record = await readConnection(name);
      if (!record || record.kind !== "openapi") {
        return { ok: false, error: `no OpenAPI connection named '${name}'` };
      }
      const removed = unregisterOpenApiConnection(registry, record);
      await deleteConnection(name);
      return { ok: true, output: `Disconnected '${name}'. Unregistered ${removed} tools, deleted record.` };
    },
  });

  const apiListTool = defineTool({
    name: "api_list",
    description:
      "WHAT: List every live API/MCP connection and the tools it contributes.\n" +
      "WHEN: You want to see what external surfaces are reachable right now without scanning the full tool catalog.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    handler: async (): Promise<ToolResult> => {
      const all = await listConnections();
      if (all.length === 0) {
        return { ok: true, output: "No external API or MCP connections. Use api_connect or mcp_attach to add one." };
      }
      const lines: string[] = [];
      for (const c of all) {
        if (c.kind === "openapi") {
          lines.push(`• openapi:${c.name} — ${c.operations.length} ops — base=${c.baseUrl} — auth=${c.auth.kind}`);
        } else {
          lines.push(`• mcp:${c.name} — ${c.tools.length} tools — url=${c.serverUrl} — auth=${c.auth.kind}`);
        }
      }
      return { ok: true, output: lines.join("\n") };
    },
  });

  return { apiConnectTool, apiDisconnectTool, apiListTool };
}

/** Restore every persisted OpenAPI connection into the live registry. */
export async function restoreOpenApiConnections(registry: ToolRegistry, emitter: AgentEmitter): Promise<number> {
  const all = await listConnections();
  let total = 0;
  for (const c of all) {
    if (c.kind !== "openapi") continue;
    try {
      total += registerOpenApiConnection(registry, c);
    } catch (e) {
      emitter.emit("error", {
        err: new Error(`Failed to restore OpenAPI connection '${c.name}': ${e instanceof Error ? e.message : String(e)}`),
      });
    }
  }
  return total;
}
