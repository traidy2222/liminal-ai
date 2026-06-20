import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDefinition, ToolRegistry, ToolResult } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import type { McpConnectionRecord } from "../external_api/api_connections_store.js";
import { invokeMcpToolFromRecord } from "../external_api/mcp_attach.js";
import { registerConnectorToolFamilies } from "../../shared/connector_family_map.js";
import { defineTool } from "../../shared/helpers.js";
import { IDA_PARENT_PROVIDER } from "./ida_connect.js";
import { injectIdaDatabaseArgs } from "./ida_session.js";

const COMPANION_TOOL_NAMES = ["ida_apply_patches_to_input", "ida_get_input_metadata"] as const;

const DIR = path.dirname(fileURLToPath(import.meta.url));

function loadRuntimeScript(filename: string): string {
  return readFileSync(path.join(DIR, filename), "utf8");
}

function hasRemoteTool(record: McpConnectionRecord, remoteName: string): boolean {
  return record.tools.some((t) => t.remoteName === remoteName);
}

async function invokeRemoteOrPyEval(
  record: McpConnectionRecord,
  remoteName: string,
  args: Record<string, unknown>,
  pyScriptFile: string,
  pyGlobals?: Record<string, unknown>
): Promise<ToolResult> {
  if (hasRemoteTool(record, remoteName)) {
    return invokeMcpToolFromRecord(record, remoteName, args);
  }
  if (!hasRemoteTool(record, "py_eval")) {
    return {
      ok: false,
      error:
        `IDA MCP missing ${remoteName} and py_eval. ` +
        "Upgrade ida-pro-mcp or run npm run ida:patch-liminal (optional native MCP tools).",
    };
  }
  const preamble = pyGlobals
    ? Object.entries(pyGlobals)
        .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
        .join("\n")
    : "";
  const code = `${preamble}\n${loadRuntimeScript(pyScriptFile)}`;
  const evalResult = await invokeMcpToolFromRecord(record, "py_eval", { code });
  if (!evalResult.ok) return evalResult;
  return { ok: true, output: evalResult.output };
}

export function registerIdaCompanionTools(registry: ToolRegistry, record: McpConnectionRecord): string[] {
  const registered: string[] = [];

  const applyPatches = defineTool({
    name: "ida_apply_patches_to_input",
    description:
      "WHAT: Write a patched PE/DLL/ELF to disk after mcp_ida_patch / mcp_ida_patch_asm.\n" +
      "WHEN: End of a crack/patch workflow — produces the shippable binary.\n" +
      "Uses native IDA MCP tool when available; otherwise runs bundled Python in IDA via py_eval.",
    parameters: {
      type: "object",
      properties: {
        output_path: {
          type: "string",
          description: "Absolute output path (empty = <input>.patched<ext> beside original).",
        },
        overwrite: {
          type: "boolean",
          description: "Overwrite output_path if it exists (default false).",
        },
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args) => {
      const output_path = typeof args["output_path"] === "string" ? args["output_path"] : "";
      const overwrite = args["overwrite"] === true;
      const injected = injectIdaCompanionArgs("ida_apply_patches_to_input", {
        output_path,
        overwrite,
      });
      return invokeRemoteOrPyEval(
        record,
        "apply_patches_to_input",
        injected,
        "ida_apply_patches_runtime.py",
        {
          output_path:
            typeof injected.output_path === "string" ? injected.output_path : output_path,
          overwrite: injected.overwrite === true || overwrite,
        }
      );
    },
  });

  const getMetadata = defineTool({
    name: "ida_get_input_metadata",
    description:
      "WHAT: Paths and module metadata for the open IDA database (input_path, imagebase, PE hint).\n" +
      "WHEN: Before patching/export — confirm which file IDA has loaded.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    requiresApproval: false,
    dangerLevel: "safe",
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args) => {
      const injected = injectIdaCompanionArgs("ida_get_input_metadata", args as Record<string, unknown>);
      return invokeRemoteOrPyEval(record, "get_input_metadata", injected, "ida_get_input_metadata_runtime.py");
    },
  });

  for (const tool of [applyPatches, getMetadata]) {
    if (registry.has(tool.name)) registry.unregister(tool.name);
    registry.register(tool);
    registered.push(tool.name);
  }

  registerConnectorToolFamilies(registry, record.name, registered, IDA_PARENT_PROVIDER);
  return registered;
}

export function unregisterIdaCompanionTools(registry: ToolRegistry): number {
  let n = 0;
  for (const name of COMPANION_TOOL_NAMES) {
    if (registry.unregister(name)) n++;
  }
  return n;
}

/** Optional: copy Python into site-packages ida-pro-mcp (native MCP tool names). */
export function idaLiminalMcpPatchEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_IDA_MCP_PATCH_LIMINAL") === "1";
}

export function injectIdaCompanionArgs(
  toolName: string,
  args: Record<string, unknown>
): Record<string, unknown> {
  if (toolName === "ida_apply_patches_to_input" || toolName === "ida_get_input_metadata") {
    return injectIdaDatabaseArgs(
      toolName === "ida_apply_patches_to_input" ? "apply_patches_to_input" : "get_input_metadata",
      args
    );
  }
  return args;
}
