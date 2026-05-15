/**
 * Dynamic tool creation — lets the model define, register, and remove tools at runtime.
 *
 * Tools are persisted as .mjs plugin files in AGENT_PLUGIN_DIR (or .agent_dynamic_tools/
 * in the workspace root) and loaded back automatically on the next harness startup.
 *
 * Each tool's handler is plain JavaScript (async function body) that receives `args`
 * and must return { ok: boolean, output?: string, error?: string }.
 *
 * Cache-busting: Node.js caches ES module imports by URL. On create/edit we append
 * ?v=<timestamp> to the file:// URL so the freshly-written file is always re-evaluated.
 */
import { mkdir, writeFile, unlink, readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ToolRegistry, AgentEmitter, ToolResult } from "@liminal/core";
import { resolveWorkspaceRoot, effectiveHarnessEnvRaw } from "@liminal/core";
import { defineTool } from "./helpers.js";

// ─── Shared helpers ───────────────────────────────────────────────────────────

function getDynamicToolDir(): string {
  return (
    effectiveHarnessEnvRaw("AGENT_PLUGIN_DIR")?.trim() ||
    join(resolveWorkspaceRoot(), ".agent_dynamic_tools")
  );
}

function toolFilePath(dir: string, name: string): string {
  return join(dir, `${name}.mjs`);
}

function isValidDynamicToolName(name: string): boolean {
  return /^[a-z][a-z0-9_]*$/.test(name);
}

function buildPluginSource(
  name: string,
  description: string,
  parameters: object,
  handlerCode: string,
  requiresApproval: boolean
): string {
  const indentedHandler = handlerCode
    .split("\n")
    .map((l) => "      " + l)
    .join("\n");
  return (
    `// Dynamic tool: ${name}\n` +
    `// Created: ${new Date().toISOString()}\n` +
    `export function register(registry, _emitter) {\n` +
    `  registry.register({\n` +
    `    name: ${JSON.stringify(name)},\n` +
    `    description: ${JSON.stringify(description)},\n` +
    `    requiresApproval: ${requiresApproval},\n` +
    `    parameters: ${JSON.stringify(parameters, null, 4).split("\n").join("\n    ")},\n` +
    `    handler: async (args) => {\n` +
    `${indentedHandler}\n` +
    `    }\n` +
    `  });\n` +
    `}\n`
  );
}

async function importAndRegister(
  filePath: string,
  registry: ToolRegistry,
  emitter: AgentEmitter
): Promise<void> {
  const url = `${pathToFileURL(filePath).href}?v=${Date.now()}`;
  const mod = (await import(/* @vite-ignore */ url)) as {
    register?: (r: ToolRegistry, e: AgentEmitter) => void | Promise<void>;
    default?: (r: ToolRegistry, e: AgentEmitter) => void | Promise<void>;
  };
  const fn = mod.register ?? mod.default;
  if (typeof fn !== "function") {
    throw new Error("Plugin file must export a named `register` function.");
  }
  await Promise.resolve(fn(registry, emitter));
}

// ─── Tool factories ───────────────────────────────────────────────────────────

export function createDynamicToolsTools(registry: ToolRegistry, emitter: AgentEmitter) {
  const createTool = defineTool({
    name: "create_tool",
    description:
      "WHAT: Define and immediately register a new callable tool into the live harness registry.\n" +
      "WHEN: You find yourself repeating the same multi-step operation, need a domain-specific helper, " +
      "want to wrap an external API, or would benefit from a persistent utility across turns.\n" +
      "The tool is persisted as a .mjs plugin file and reloaded automatically on restart.\n" +
      "HANDLER FORMAT: Write the body of an async function that receives `args` (Record<string,unknown>) " +
      "and returns { ok: boolean, output?: string, error?: string }. " +
      "You may use await, import() for Node built-ins, and any logic you need.\n" +
      "ARGS: name (snake_case), description (WHAT/WHEN/ARGS format), parameters (JSON Schema object), " +
      "handler_code (function body string), requires_approval (default false).",
    requiresApproval: true,
    dangerLevel: "destructive" as const,
    resourceLocks: () => ["file:write:dynamic_tools"],
    parameters: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Snake_case tool name (e.g. parse_invoice, fetch_github_issue).",
        },
        description: {
          type: "string",
          description: "Tool description in WHAT/WHEN/ARGS format — shown to you in future turns.",
        },
        parameters: {
          type: "object",
          description: "JSON Schema object describing the tool's arguments.",
        },
        handler_code: {
          type: "string",
          description:
            "Body of an async (args) => ToolResult function. " +
            "Return { ok: true, output: string } or { ok: false, error: string }. " +
            "Use `const x = args['x']` to read arguments. May use await and Node.js built-ins.",
        },
        requires_approval: {
          type: "boolean",
          description: "If true, user must approve each invocation (default false).",
        },
      },
      required: ["name", "description", "parameters", "handler_code"],
      additionalProperties: false,
    },
    handler: async (args): Promise<ToolResult> => {
      const name = String(args["name"] ?? "").trim();
      const description = String(args["description"] ?? "").trim();
      const parameters = (args["parameters"] as object | undefined) ?? { type: "object", properties: {}, additionalProperties: false };
      const handlerCode = String(args["handler_code"] ?? "").trim();
      const requiresApproval = Boolean(args["requires_approval"] ?? false);

      if (!name || !isValidDynamicToolName(name)) {
        return { ok: false, error: "name must be snake_case (lowercase letters, digits, underscores), starting with a letter." };
      }
      if (!handlerCode) return { ok: false, error: "handler_code is required." };
      if (registry.has(name)) {
        return { ok: false, error: `Tool '${name}' is already registered. Use edit_tool to update it, or remove_tool then create_tool.` };
      }

      const dir = getDynamicToolDir();
      await mkdir(dir, { recursive: true });
      const filePath = toolFilePath(dir, name);

      const source = buildPluginSource(name, description, parameters, handlerCode, requiresApproval);
      await writeFile(filePath, source, "utf-8");

      try {
        await importAndRegister(filePath, registry, emitter);
      } catch (e) {
        await unlink(filePath).catch(() => {});
        return {
          ok: false,
          error: `Tool file written but failed to load: ${e instanceof Error ? e.message : String(e)}\nCheck your handler_code for syntax errors.`,
        };
      }

      return {
        ok: true,
        output:
          `Tool '${name}' created and registered.\n` +
          `Persisted to: ${filePath}\n` +
          `You can now call it directly. It will also be available after restart.`,
      };
    },
  });

  const editTool = defineTool({
    name: "edit_tool",
    description:
      "WHAT: Update an existing dynamic tool's description, parameters, or handler code and hot-reload it.\n" +
      "WHEN: A self-created tool has a bug, needs new arguments, or its behaviour needs refinement.\n" +
      "Only works on tools created via create_tool (not built-in tools).\n" +
      "ARGS: name — the tool to update; then any subset of description/parameters/handler_code to replace.",
    requiresApproval: true,
    dangerLevel: "destructive" as const,
    resourceLocks: () => ["file:write:dynamic_tools"],
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the dynamic tool to update." },
        description: { type: "string", description: "New description (omit to keep current)." },
        parameters: { type: "object", description: "New JSON Schema parameters (omit to keep current)." },
        handler_code: { type: "string", description: "New handler function body (omit to keep current)." },
        requires_approval: { type: "boolean", description: "Update approval requirement (omit to keep current)." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: async (args): Promise<ToolResult> => {
      const name = String(args["name"] ?? "").trim();
      if (!name || !isValidDynamicToolName(name)) {
        return {
          ok: false,
          error:
            "name must be snake_case (lowercase letters, digits, underscores), starting with a letter.",
        };
      }
      const dir = getDynamicToolDir();
      const filePath = toolFilePath(dir, name);

      if (!existsSync(filePath)) {
        return { ok: false, error: `No dynamic tool '${name}' found at ${filePath}. Only tools created via create_tool can be edited.` };
      }

      // Read current source to extract fields we're not updating
      let currentSource: string;
      try {
        currentSource = await readFile(filePath, "utf-8");
      } catch (e) {
        return { ok: false, error: `Cannot read current tool file: ${e instanceof Error ? e.message : String(e)}` };
      }

      // Extract current values from current registration for fields not being replaced
      const current = registry.get(name);
      const newDescription = args["description"] !== undefined
        ? String(args["description"])
        : (current?.description ?? "");
      const newParameters = args["parameters"] !== undefined
        ? (args["parameters"] as object)
        : (current?.parameters ?? { type: "object", properties: {}, additionalProperties: false });
      const newRequiresApproval = args["requires_approval"] !== undefined
        ? Boolean(args["requires_approval"])
        : (current?.requiresApproval ?? false);

      // Extract handler code from current source if not being replaced
      let newHandlerCode: string;
      if (args["handler_code"] !== undefined) {
        newHandlerCode = String(args["handler_code"]).trim();
      } else {
        // Pull handler body from existing file between the handler: async (args) => { and closing }
        const match = /handler: async \(args\) => \{\n([\s\S]*?)\n    \}\n  \}\)/.exec(currentSource);
        newHandlerCode = match ? match[1].replace(/^      /gm, "") : "";
      }

      const source = buildPluginSource(name, newDescription, newParameters, newHandlerCode, newRequiresApproval);
      await writeFile(filePath, source, "utf-8");

      // Unregister old, register new
      registry.unregister(name);
      try {
        await importAndRegister(filePath, registry, emitter);
      } catch (e) {
        return { ok: false, error: `Tool file updated but failed to reload: ${e instanceof Error ? e.message : String(e)}` };
      }

      return { ok: true, output: `Tool '${name}' updated and reloaded.` };
    },
  });

  const removeTool = defineTool({
    name: "remove_tool",
    description:
      "WHAT: Unregister a dynamic tool from the live registry and delete its plugin file.\n" +
      "WHEN: A self-created tool is no longer needed, needs to be replaced, or has a name conflict.\n" +
      "Only works on tools created via create_tool (files in the dynamic tool directory).",
    requiresApproval: true,
    dangerLevel: "destructive" as const,
    resourceLocks: () => ["file:write:dynamic_tools"],
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Name of the dynamic tool to remove." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: async (args): Promise<ToolResult> => {
      const name = String(args["name"] ?? "").trim();
      if (!name || !isValidDynamicToolName(name)) {
        return {
          ok: false,
          error:
            "name must be snake_case (lowercase letters, digits, underscores), starting with a letter.",
        };
      }
      const dir = getDynamicToolDir();
      const filePath = toolFilePath(dir, name);

      if (!existsSync(filePath)) {
        return { ok: false, error: `No dynamic tool file found for '${name}' at ${filePath}.` };
      }

      registry.unregister(name);
      await unlink(filePath);

      return { ok: true, output: `Tool '${name}' removed from registry and deleted.` };
    },
  });

  const listDynamicTools = defineTool({
    name: "list_dynamic_tools",
    description:
      "WHAT: List all tools created via create_tool — shows name, registration status, and file path.\n" +
      "WHEN: Auditing what dynamic tools exist, checking which loaded successfully, or before removing one.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async (): Promise<ToolResult> => {
      const dir = getDynamicToolDir();
      if (!existsSync(dir)) {
        return { ok: true, output: "No dynamic tools directory found — no tools have been created yet." };
      }

      let files: string[];
      try {
        files = (await readdir(dir)).filter((f) => f.endsWith(".mjs"));
      } catch {
        return { ok: false, error: `Cannot read dynamic tool directory: ${dir}` };
      }

      if (files.length === 0) {
        return { ok: true, output: `Dynamic tool directory exists (${dir}) but contains no tools.` };
      }

      const lines = files.map((f) => {
        const name = f.replace(/\.mjs$/, "");
        const live = registry.has(name) ? "✓ live" : "✗ not loaded";
        return `- ${name} [${live}]  ${join(dir, f)}`;
      });

      return {
        ok: true,
        output: `Dynamic tools (${files.length}) in ${dir}:\n${lines.join("\n")}`,
      };
    },
  });

  return { createTool, editTool, removeTool, listDynamicTools };
}

/**
 * Load all persisted dynamic tools from the dynamic tool directory on startup.
 * Called by registerAllTools() so tools survive harness restarts.
 */
export async function loadDynamicTools(
  registry: ToolRegistry,
  emitter: AgentEmitter
): Promise<void> {
  const dir = getDynamicToolDir();
  if (!existsSync(dir)) return;

  let files: string[];
  try {
    const { readdirSync } = await import("node:fs");
    files = readdirSync(dir).filter((f) => f.endsWith(".mjs"));
  } catch {
    return;
  }

  for (const file of files) {
    const filePath = join(dir, file);
    const name = file.replace(/\.mjs$/, "");
    if (registry.has(name)) continue; // already registered (e.g. by plugin_loader)
    try {
      await importAndRegister(filePath, registry, emitter);
    } catch (e) {
      emitter.emit("error", {
        err: new Error(`Failed to load dynamic tool '${name}': ${e instanceof Error ? e.message : String(e)}`),
      });
    }
  }
}
