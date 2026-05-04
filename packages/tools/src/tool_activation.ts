import type { ToolRegistry } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { TOOL_FAMILIES } from "./tool_catalog.js";

/**
 * Tools for discovering and loading tool families when AGENT_TOOL_LAZY=1.
 * Close over the same registry instance used by the harness.
 */
export function createToolDiscoveryTools(registry: ToolRegistry) {
  const listToolFamiliesTool = defineTool({
    name: "list_tool_families",
    description:
      "WHAT: List available tool families (lazy loading) and which tools are currently active.\n" +
      "WHEN: AGENT_TOOL_LAZY=1 and you need capabilities not yet loaded, or to plan which family to activate.\n" +
      "ARGS: none.",
    requiresApproval: false,
    dangerLevel: "safe",
    cacheable: false,
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    handler: async () => {
      const active = new Set(registry.getActiveToolNames());
      const lines: string[] = [];
      lines.push(`Lazy tool loading: ${registry.isLazyToolLoading() ? "ON" : "OFF"}`);
      lines.push(`Active tool count: ${active.size}`);
      lines.push("");
      lines.push("Families (call activate_tool_family with { family: \"<id>\" }):");
      for (const [id, def] of Object.entries(TOOL_FAMILIES)) {
        const present = def.tools.filter((t) => registry.has(t));
        if (present.length === 0) continue;
        const activeHere = present.filter((t) => active.has(t)).length;
        lines.push(`- ${id}: ${def.description} (${activeHere}/${present.length} active here)`);
      }
      lines.push("");
      lines.push("Active tools:");
      lines.push([...active].sort().join(", ") || "(none)");
      return { ok: true, output: lines.join("\n") };
    },
  });

  const activateToolFamilyTool = defineTool({
    name: "activate_tool_family",
    description:
      "WHAT: Load all tools in a named family into the active set (visible to the model on later rounds).\n" +
      "WHEN: AGENT_TOOL_LAZY=1 and list_tool_families shows you need a family (e.g. git, shell, vault).\n" +
      "ARGS: family — id from list_tool_families (e.g. \"git\", \"shell\").",
    requiresApproval: false,
    dangerLevel: "safe",
    cacheable: false,
    parameters: {
      type: "object",
      properties: {
        family: { type: "string", description: "Family id (e.g. git, code_intel, vault)" },
      },
      required: ["family"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const family = String(args["family"] ?? "").trim().toLowerCase();
      if (!family) return { ok: false, error: "family is required" };
      const def = TOOL_FAMILIES[family];
      if (!def) {
        const ids = Object.keys(TOOL_FAMILIES).sort().join(", ");
        return { ok: false, error: `Unknown family "${family}". Known: ${ids}` };
      }
      const toActivate = def.tools.filter((t) => registry.has(t));
      if (toActivate.length === 0) {
        return { ok: false, error: `Family "${family}" has no tools registered in this harness.` };
      }
      const newly = registry.activate(toActivate);
      return {
        ok: true,
        output:
          `Family "${family}" activated. Newly visible: ${newly.length ? newly.sort().join(", ") : "(already active)"}\n` +
          `Total active tools: ${registry.getActiveToolNames().length}`,
      };
    },
  });

  return { listToolFamiliesTool, activateToolFamilyTool };
}
