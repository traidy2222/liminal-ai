import type { LiminalAppManagerPort, LiminalAppType, LiminalAppShell } from "@liminal/core";
import {
  LIMINAL_APP_TYPES,
  applyHtmlEdit,
  buildAppSpecFromSpawn,
  effectiveHarnessEnvRaw,
  getApp,
  grepAppHtmlLines,
  liminalAppsEnabled,
  readAppHtmlSlice,
  resolveStoredAppHtml,
  sanitizeAppId,
  validateAppProps,
} from "@liminal/core";
import type { AgentHarness, ToolRegistry } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { TOOL_FAMILIES } from "../../tool_catalog.js";
import { analyzeHtmlCoherence, formatHtmlCoherenceFooter } from "../files/html_write_coherence.js";

const SPAWN_APP_TYPES = [
  "weather",
  "html",
  "markdown",
  "chart",
  "table",
  "iframe",
] as const;

const WIDGET_ITERATION_TYPES = new Set<LiminalAppType>([
  "html",
  "markdown",
  "chart",
  "table",
  "iframe",
]);

function spawnBlockedByExistingApps(
  apps: Awaited<ReturnType<LiminalAppManagerPort["listApps"]>>,
  type: LiminalAppType,
  explicitId?: string
): string | null {
  if (explicitId) {
    const id = sanitizeAppId(explicitId);
    const dup = apps.find((a) => a.id === id);
    if (dup) {
      return (
        `Desktop app "${dup.id}" already exists (type=${dup.type}, title="${dup.title}"). ` +
        `Use update_app({ id: "${dup.id}", ... }) — do not spawn_app again.`
      );
    }
    return null;
  }
  if (!WIDGET_ITERATION_TYPES.has(type)) return null;
  const sameType = apps.filter((a) => a.type === type);
  if (sameType.length === 1) {
    const only = sameType[0]!;
    return (
      `Desktop ${type} widget already open (id=${only.id}, title="${only.title}"). ` +
      `Use update_app({ id: "${only.id}", ... }) for changes. Call list_apps to confirm.`
    );
  }
  if (sameType.length > 1) {
    return (
      `Multiple ${type} widgets already exist (${sameType.map((a) => a.id).join(", ")}). ` +
      `Use update_app with the target id — do not spawn_app again unless the user asked for another window.`
    );
  }
  return null;
}

export function createLiminalAppTools(
  _registry: ToolRegistry,
  appManager: LiminalAppManagerPort | undefined,
  _harness?: AgentHarness
) {
  const enabled = () => liminalAppsEnabled() && !!appManager?.isEnabled();

  const listAppTypesTool = defineTool({
    name: "list_app_types",
    description:
      "WHAT: Catalog of Liminal desktop app types the model can spawn as separate OS windows.\n" +
      "WHEN: Before spawn_app — see allowed types and prop schemas.\n" +
      "Types: weather, html (custom UI), markdown, chart, table, iframe.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      if (!enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable in this runtime." };
      }
      const lines = LIMINAL_APP_TYPES.map(
        (t) =>
          `- ${t.type}: ${t.label} — ${t.description}\n  default refresh: ${t.defaultRefreshMin}m\n  props: ${JSON.stringify(t.propsSchema)}`
      );
      return { ok: true, output: lines.join("\n") };
    },
  });

  const listAppsTool = defineTool({
    name: "list_apps",
    description:
      "List spawned Liminal desktop apps and cache freshness. Call before spawn_app — if a widget exists, use update_app instead.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 5_000,
    parameters: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => {
      if (!appManager || !enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable." };
      }
      const { apps, caches } = await appManager.listAppsWithCaches();
      if (apps.length === 0) return { ok: true, output: "(no desktop apps spawned)" };
      const lines = apps.map((a) => {
        const c = caches[a.id];
        const fresh = c ? `${c.ok ? "ok" : "err"} @ ${new Date(c.fetched_at).toISOString()}` : "never";
        return `- ${a.id} [${a.type}] "${a.title}" — cache: ${fresh}`;
      });
      return { ok: true, output: lines.join("\n") };
    },
  });

  const readAppHtmlTool = defineTool({
    name: "read_app_html",
    description:
      "WHAT: Read numbered lines from a spawned html widget's persisted document (~/.liminal/apps/html/).\n" +
      "WHEN: Before html_edit patches — same role as read_file for widget HTML.\n" +
      "NOT: workspace files — use read_file for repo paths.",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 2_000,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "App id from spawn_app" },
        start_line: { type: "number", description: "1-based start line (default 1)" },
        end_line: { type: "number", description: "1-based end line (default EOF)" },
        max_chars: { type: "number", description: "Max chars to return (default 24000)" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable." };
      }
      const id = String(args["id"] ?? "").trim();
      if (!id) return { ok: false, error: "id required" };
      const spec = await getApp(id);
      if (!spec) return { ok: false, error: `Unknown app id: ${id}` };
      if (spec.type !== "html") return { ok: false, error: "read_app_html only applies to type=html apps." };
      const html = await resolveStoredAppHtml(spec);
      const output = readAppHtmlSlice(html, {
        startLine: typeof args["start_line"] === "number" ? args["start_line"] : undefined,
        endLine: typeof args["end_line"] === "number" ? args["end_line"] : undefined,
        maxChars: typeof args["max_chars"] === "number" ? args["max_chars"] : undefined,
      });
      return { ok: true, output: `Widget ${id} (${html.length} chars):\n${output}` };
    },
  });

  const grepAppHtmlTool = defineTool({
    name: "grep_app_html",
    description:
      "WHAT: Search a spawned html widget's persisted document with line context.\n" +
      "WHEN: Locate anchors before update_app html_edit — same role as grep_file.\n" +
      "WORKFLOW: grep_app_html → update_app({ id, html_edit: { replacements: [...] } }).",
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 2_000,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "App id" },
        pattern: { type: "string", description: "Substring or regex pattern" },
        regex: { type: "boolean", description: "Treat pattern as regex (default false)" },
        flags: { type: "string", description: "Regex flags (default i)" },
        context_lines: { type: "number", description: "Context lines around each hit (default 2)" },
      },
      required: ["id", "pattern"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable." };
      }
      const id = String(args["id"] ?? "").trim();
      const pattern = String(args["pattern"] ?? "");
      if (!id || !pattern) return { ok: false, error: "id and pattern required" };
      const spec = await getApp(id);
      if (!spec) return { ok: false, error: `Unknown app id: ${id}` };
      if (spec.type !== "html") return { ok: false, error: "grep_app_html only applies to type=html apps." };
      const html = await resolveStoredAppHtml(spec);
      const output = grepAppHtmlLines(html, pattern, {
        regex: args["regex"] === true,
        flags: typeof args["flags"] === "string" ? args["flags"] : "i",
        contextLines: typeof args["context_lines"] === "number" ? args["context_lines"] : undefined,
      });
      return { ok: true, output: `grep ${id} /${pattern}/\n${output}` };
    },
  });

  const previewAppHtmlTool = defineTool({
    name: "preview_app_html",
    description:
      "WHAT: Validate html/markdown/chart/table widget props before spawn_app.\n" +
      "WHEN: Large custom html widgets — check props validate without opening a window.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...SPAWN_APP_TYPES] },
        props: { type: "object" },
      },
      required: ["type", "props"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const type = String(args["type"] ?? "") as LiminalAppType;
      const props = (args["props"] as Record<string, unknown>) ?? {};
      const v = validateAppProps(type, props);
      if (!v.ok) return { ok: false, error: v.error };
      const built = buildAppSpecFromSpawn({ type, props: v.props, title: "Preview" });
      if (!built.ok) return { ok: false, error: built.error };
      const htmlLen =
        type === "html" ? String(v.props["html"] ?? "").length : 0;
      return {
        ok: true,
        output:
          `Props valid for type=${type}.` +
          (htmlLen > 0 ? ` html chars=${htmlLen}.` : "") +
          " Call spawn_app to open the desktop window.",
      };
    },
  });

  const spawnAppTool = defineTool({
    name: "spawn_app",
    description:
      "WHAT: Open a persistent Liminal desktop widget (NOT write_file, NOT in-chat html).\n" +
      "WHEN: User wants a NEW widget/dashboard on desktop — only when none exists yet for that purpose.\n" +
      "BEFORE CALLING: list_apps — if a matching widget id/type already exists, use update_app instead.\n" +
      "HOW (html): spawn_app({ type:\"html\", props:{ html:\"<!DOCTYPE html>…full document…</html>\" } }) in ONE call. " +
      "Large HTML streams like write_file — if cut off, re-issue spawn_app with the same id (or update_app if already spawned). " +
      "Do NOT spawn an empty shell then append chunks. One complete document per spawn.\n" +
      "Types: weather, html, markdown, chart, table, iframe. Default shell.mode=widget.",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...SPAWN_APP_TYPES], description: "App type" },
        id: { type: "string", description: "Optional stable id slug" },
        title: { type: "string", description: "Window title" },
        props: { type: "object", description: "Type-specific props" },
        placement: {
          type: "object",
          description: "Widget size/position (default compact per type)",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
            x: { type: "number" },
            y: { type: "number" },
          },
        },
        shell: {
          type: "object",
          description: 'Window chrome — default { mode: "widget", frameless: true, always_on_top: false }',
          properties: {
            mode: { type: "string", enum: ["widget", "window"] },
            frameless: { type: "boolean" },
            always_on_top: { type: "boolean" },
            skip_taskbar: { type: "boolean" },
            opacity: { type: "number", minimum: 0.5, maximum: 1 },
          },
        },
        refresh: {
          type: "object",
          properties: { interval_min: { type: "number" } },
        },
        auto_open: { type: "boolean", description: "Open window immediately (default true)" },
      },
      required: ["type", "props"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!appManager || !enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable." };
      }
      const type = String(args["type"] ?? "") as LiminalAppType;
      const explicitId = typeof args["id"] === "string" ? args["id"].trim() : undefined;
      const existingApps = await appManager.listApps();
      const blocked = spawnBlockedByExistingApps(existingApps, type, explicitId);
      if (blocked) return { ok: false, error: blocked };
      const props = (args["props"] as Record<string, unknown>) ?? {};
      const placementRaw = args["placement"];
      const shellRaw = args["shell"];
      try {
        const spec = await appManager.spawnApp({
          type,
          id: typeof args["id"] === "string" ? args["id"] : undefined,
          title: typeof args["title"] === "string" ? args["title"] : undefined,
          props,
          placement:
            placementRaw && typeof placementRaw === "object"
              ? {
                  width: Number((placementRaw as Record<string, unknown>)["width"] ?? 0),
                  height: Number((placementRaw as Record<string, unknown>)["height"] ?? 0),
                  x:
                    (placementRaw as Record<string, unknown>)["x"] != null
                      ? Number((placementRaw as Record<string, unknown>)["x"])
                      : undefined,
                  y:
                    (placementRaw as Record<string, unknown>)["y"] != null
                      ? Number((placementRaw as Record<string, unknown>)["y"])
                      : undefined,
                }
              : undefined,
          shell:
            shellRaw && typeof shellRaw === "object"
              ? (shellRaw as LiminalAppShell)
              : undefined,
          refresh:
            args["refresh"] && typeof args["refresh"] === "object"
              ? {
                  interval_min: Number(
                    (args["refresh"] as Record<string, unknown>)["interval_min"] ?? 45
                  ),
                }
              : undefined,
          auto_open: args["auto_open"] !== false,
          source: "model",
        });
        const html = type === "html" ? await resolveStoredAppHtml(spec) : "";
        const coherence =
          html.length > 0 ? formatHtmlCoherenceFooter(analyzeHtmlCoherence(html)) : "";
        const proxyHosts = spec.props["proxy_hosts"];
        const proxyNote = Array.isArray(proxyHosts) && proxyHosts.length > 0
          ? ` Proxy hosts: ${proxyHosts.join(", ")}.`
          : "";
        const mode = spec.shell?.mode ?? "widget";
        return {
          ok: true,
          output:
            `Spawned desktop ${mode} "${spec.title}" (id=${spec.id}, type=${spec.type}).` +
            ` Widget should appear on the desktop.${proxyNote}` +
            (html.length > 0 ? ` html_chars=${html.length}.` : "") +
            (coherence ? ` ${coherence}` : ""),
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const updateAppTool = defineTool({
    name: "update_app",
    description:
      "WHAT: Update a spawned desktop app.\n" +
      "html widgets — three modes (pick one):\n" +
      "  1) props.html — full document replace (streams like write_file overwrite)\n" +
      "  2) html_edit.replacements — edit_file-style find/replace (grep_app_html first)\n" +
      "  3) html_edit.diff — unified diff hunk\n" +
      "Also: title, placement, shell, refresh, auto_open.",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "App id" },
        title: { type: "string" },
        props: { type: "object", description: "Merged into app props — use props.html for full rewrite" },
        html_edit: {
          type: "object",
          description: "edit_file-style patch on stored widget HTML (html apps only)",
          properties: {
            replacements: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  search: { type: "string" },
                  replace: { type: "string" },
                  regex: { type: "boolean" },
                  flags: { type: "string" },
                },
                required: ["search", "replace"],
              },
            },
            diff: { type: "string", description: "Unified diff hunk with @@ header" },
            preview: { type: "boolean", description: "Dry run — report matches without writing" },
          },
        },
        placement: {
          type: "object",
          properties: {
            width: { type: "number" },
            height: { type: "number" },
            x: { type: "number" },
            y: { type: "number" },
          },
        },
        shell: {
          type: "object",
          properties: {
            mode: { type: "string", enum: ["widget", "window"] },
            frameless: { type: "boolean" },
            always_on_top: { type: "boolean" },
            skip_taskbar: { type: "boolean" },
            opacity: { type: "number", minimum: 0.5, maximum: 1 },
          },
        },
        refresh: {
          type: "object",
          properties: { interval_min: { type: "number" } },
        },
        auto_open: { type: "boolean" },
      },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!appManager || !enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable." };
      }
      const id = String(args["id"] ?? "").trim();
      if (!id) return { ok: false, error: "id required" };

      const htmlEditRaw = args["html_edit"];
      if (htmlEditRaw && typeof htmlEditRaw === "object") {
        const spec = await getApp(id);
        if (!spec) return { ok: false, error: `Unknown app id: ${id}` };
        if (spec.type !== "html") {
          return { ok: false, error: "html_edit only applies to type=html apps." };
        }
        const edit = htmlEditRaw as Record<string, unknown>;
        const stored = await resolveStoredAppHtml(spec);
        const edited = applyHtmlEdit(stored, {
          replacements: Array.isArray(edit["replacements"])
            ? (edit["replacements"] as Parameters<typeof applyHtmlEdit>[1]["replacements"])
            : undefined,
          diff: typeof edit["diff"] === "string" ? edit["diff"] : undefined,
        });
        if (edited.report.some((r) => r.startsWith("ERROR"))) {
          return { ok: false, error: edited.report.join("\n") };
        }
        if (edit["preview"] === true) {
          return {
            ok: true,
            output: ["PREVIEW — no changes written", ...edited.report].join("\n"),
          };
        }
        if (!edited.changed) {
          return { ok: true, output: edited.report.join("\n") || "No changes." };
        }
        try {
          const updated = await appManager.updateApp(id, {
            props: { html: edited.content, interactivity: "sandbox" },
          });
          const coherence = formatHtmlCoherenceFooter(analyzeHtmlCoherence(edited.content));
          return {
            ok: true,
            output:
              `Patched widget ${updated.id} (${updated.title}).\n${edited.report.join("\n")}` +
              (coherence ? `\n${coherence}` : ""),
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      }

      const placementRaw = args["placement"];
      const shellRaw = args["shell"];
      try {
        const spec = await appManager.updateApp(id, {
          title: typeof args["title"] === "string" ? args["title"] : undefined,
          props: args["props"] as Record<string, unknown> | undefined,
          placement:
            placementRaw && typeof placementRaw === "object"
              ? {
                  width: Number((placementRaw as Record<string, unknown>)["width"] ?? 0),
                  height: Number((placementRaw as Record<string, unknown>)["height"] ?? 0),
                  x:
                    (placementRaw as Record<string, unknown>)["x"] != null
                      ? Number((placementRaw as Record<string, unknown>)["x"])
                      : undefined,
                  y:
                    (placementRaw as Record<string, unknown>)["y"] != null
                      ? Number((placementRaw as Record<string, unknown>)["y"])
                      : undefined,
                }
              : undefined,
          shell:
            shellRaw && typeof shellRaw === "object"
              ? (shellRaw as LiminalAppShell)
              : undefined,
          refresh:
            args["refresh"] && typeof args["refresh"] === "object"
              ? {
                  interval_min: Number(
                    (args["refresh"] as Record<string, unknown>)["interval_min"] ?? 45
                  ),
                }
              : undefined,
          auto_open: typeof args["auto_open"] === "boolean" ? args["auto_open"] : undefined,
        });
        let extra = "";
        if (spec.type === "html" && args["props"] && typeof args["props"] === "object") {
          const html = await resolveStoredAppHtml(spec);
          const coherence = formatHtmlCoherenceFooter(analyzeHtmlCoherence(html));
          extra = ` html_chars=${html.length}.${coherence ? ` ${coherence}` : ""}`;
        }
        return { ok: true, output: `Updated app ${spec.id} (${spec.title}).${extra}` };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
  });

  const closeAppTool = defineTool({
    name: "close_app",
    description: "Remove a Liminal desktop app (closes its window and deletes persisted spec).",
    requiresApproval: true,
    dangerLevel: "destructive",
    parameters: {
      type: "object",
      properties: { id: { type: "string", description: "App id to remove" } },
      required: ["id"],
      additionalProperties: false,
    },
    handler: async (args) => {
      if (!appManager || !enabled()) {
        return { ok: false, error: "Liminal desktop apps are disabled or unavailable." };
      }
      const id = String(args["id"] ?? "").trim();
      const ok = await appManager.closeApp(id);
      if (!ok) return { ok: false, error: `Unknown app id: ${id}` };
      return { ok: true, output: `Closed and removed desktop app ${id}.` };
    },
  });

  return {
    listAppTypesTool,
    listAppsTool,
    readAppHtmlTool,
    grepAppHtmlTool,
    previewAppHtmlTool,
    spawnAppTool,
    updateAppTool,
    closeAppTool,
  };
}

export const LIMINAL_APP_TOOL_NAMES = [
  "list_app_types",
  "list_apps",
  "read_app_html",
  "grep_app_html",
  "preview_app_html",
  "spawn_app",
  "update_app",
  "close_app",
] as const;

/** When desktop sidecar is present, keep liminal_apps visible under lazy loading. */
export function bootstrapLiminalAppsTools(registry: ToolRegistry): string[] {
  if (!liminalAppsEnabled()) return [];
  if (!registry.isLazyToolLoading()) return [];
  const names = TOOL_FAMILIES.liminal_apps.tools.filter((t) => registry.has(t));
  return names.length > 0 ? registry.activate(names) : [];
}
