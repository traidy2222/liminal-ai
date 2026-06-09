import type { ToolRegistry } from "@liminal/core";
import { isFamilyEntitled, loadHarnessEntitlements, ENTITLEMENT_GATED_FAMILIES } from "@liminal/core";
import { defineTool } from "./helpers.js";
import { TOOL_FAMILIES, summarizeFamilyActivity } from "./tool_catalog.js";
import { matchesAgentcardIntent } from "./agentcard_cli.js";

/**
 * Tools for discovering and loading tool families when AGENT_TOOL_LAZY=1.
 * Close over the same registry instance used by the harness.
 */
export function createToolDiscoveryTools(registry: ToolRegistry) {
  function recommendFamilyFromHint(raw: string): string | null {
    const hint = raw.trim().toLowerCase();
    if (!hint) return null;
    if (matchesAgentcardIntent(hint)) return "agentcard";
    if (/(write|edit|patch|create file|rewrite|modify file)/.test(hint)) return "files_edit";
    if (/(shell|terminal|command|npm|build|test|install|process)/.test(hint)) return "shell";
    if (/(git|commit|branch|diff|status|log)/.test(hint)) return "git";
    if (/(weather|news|search|fetch|research|web)/.test(hint)) return "web";
    if (/(price|stock|fx|crypto|commodity|market)/.test(hint)) return "markets";
    if (/(vision|image|screenshot|ocr|diagram)/.test(hint)) return "vision";
    if (/(memory|recall|remember|vault|obsidian|notes)/.test(hint)) return "memory_advanced";
    if (/(slack|channel|workspace chat)/.test(hint)) return "slack";
    if (/(linear|backlog|sprint item)/.test(hint)) return "linear";
    if (/(notion|wiki page|notion database)/.test(hint)) return "notion";
    if (/(xero|invoice|accounting)/.test(hint)) return "xero";
    if (/(github|pull request|merge request|repo issue)/.test(hint)) return "github";
    if (/(outlook|onedrive|teams|planner|sharepoint|office 365|m365|microsoft)/.test(hint)) {
      return "microsoft_365";
    }
    if (/(google|gmail|sheet|spreadsheet|drive|calendar|workspace|gdoc|docs|slides)/.test(hint)) {
      return "google_workspace";
    }
    if (/(connect|integration|oauth)/.test(hint)) return "connectors";
    if (/(powerpoint|pptx|ppx|slides|docx|pdf|document)/.test(hint)) return "document";
    if (/(code|symbol|reference|lint|execute code|ast)/.test(hint)) return "code_intel";
    if (/(browser|playwright|chromium|frontend|ui test|web page|screenshot)/.test(hint))
      return "browser";
    return null;
  }

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
      properties: {
        task_hint: {
          type: "string",
          description: "Optional one-line hint about intended next action to suggest a family.",
          minLength: 0,
          maxLength: 240,
        },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const active = new Set(registry.getActiveToolNames());
      const families = summarizeFamilyActivity(registry);
      const taskHint = String(args["task_hint"] ?? "");
      const lines: string[] = [];
      lines.push(`Lazy tool loading: ${registry.isLazyToolLoading() ? "ON" : "OFF"}`);
      lines.push(`Active tool count: ${active.size}`);
      lines.push("");
      lines.push("Families (call activate_tool_family with { family: \"<id>\" }):");
      for (const f of families) {
        lines.push(`- ${f.family}: ${f.description} (${f.active}/${f.total} active here)`);
      }
      if (families.some((f) => f.family === "document")) {
        lines.push("");
        lines.push(`Note: "ppx" means PowerPoint/PPTX. Use document family + doc_render_pptx for deck artifacts.`);
      }
      if (families.some((f) => f.family === "vision")) {
        lines.push(`Note: Vision sidecar available via "vision" family. Use vision_analyze when seeing an image would improve accuracy.`);
      }
      if (families.some((f) => f.family === "markets")) {
        lines.push(`Note: Use "markets_quote" from markets family for prices/costing with as-of + source metadata.`);
      }
      if (families.some((f) => f.family === "agentcard")) {
        lines.push(
          `Note: AgentCard payments — activate_tool_family({ family: "agentcard" }) or mention payments/checkout in task_hint.`
        );
      }
      lines.push("");
      lines.push("Active tools:");
      lines.push([...active].sort().join(", ") || "(none)");
      const recommendation = recommendFamilyFromHint(taskHint);
      if (recommendation) {
        lines.push("");
        lines.push(`Recommended next family for this task_hint: ${recommendation}`);
      }
      lines.push("");
      lines.push(
        "Troubleshooting: if a tool says 'not loaded for this session', call list_tool_families({task_hint}) -> activate_tool_family({family}) -> retry."
      );
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
      const knownStatic = family in TOOL_FAMILIES;
      const isDynamicConnector = family.startsWith("connector:");
      if (!knownStatic && !isDynamicConnector) {
        const ids = Object.keys(TOOL_FAMILIES).sort().join(", ");
        return {
          ok: false,
          error: `Unknown family "${family}". Known static families: ${ids}. Custom MCP: connector:<name>.`,
        };
      }
      if (ENTITLEMENT_GATED_FAMILIES[family]) {
        const entitlements = await loadHarnessEntitlements();
        if (!isFamilyEntitled(family, entitlements)) {
          return {
            ok: false,
            error: `Family "${family}" requires a paid Vireon license (Pro+). Connect with liminal login.`,
          };
        }
      }
      let newly = registry.activateFamilies([family]);
      if (knownStatic && def?.tools.length) {
        const fromCatalog = registry.activate(def.tools.filter((t) => registry.has(t)));
        newly = [...new Set([...newly, ...fromCatalog])];
      }
      if (newly.length === 0) {
        const hint =
          family === "github"
            ? ' Connect GitHub first (connect_provider start_oauth), then activate family "github".'
            : "";
        return {
          ok: false,
          error: `Family "${family}" has no tools registered in this harness.${hint}`,
        };
      }
      const browserHint =
        family === "browser"
          ? "\nBrowser loop: browser_open → browser_snapshot/browser_act(click_ref) → browser_close (or close_all:true)."
          : "";
      return {
        ok: true,
        output:
          `Family "${family}" activated. Newly visible: ${newly.length ? newly.sort().join(", ") : "(already active)"}\n` +
          `Total active tools: ${registry.getActiveToolNames().length}${browserHint}`,
      };
    },
  });

  return { listToolFamiliesTool, activateToolFamilyTool };
}
