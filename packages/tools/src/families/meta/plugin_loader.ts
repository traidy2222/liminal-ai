/**
 * Plugin/Extension System — dynamically loads tool plugins from AGENT_PLUGIN_DIR.
 *
 * Each plugin file must export a default function (or named `register`) with signature:
 *   register(registry: ToolRegistry, emitter: AgentEmitter): void | Promise<void>
 *
 * Supports .mjs and .js files. Runs at harness startup via loadPlugins().
 * Set AGENT_PLUGIN_DIR to an absolute path to your plugins directory.
 *
 * Example plugin file (~/.agent_plugins/my_tool.mjs):
 *   export function register(registry, emitter) {
 *     registry.register({ name: "my_tool", ... });
 *   }
 */
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import type { ToolRegistry, AgentEmitter } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";

export interface PluginModule {
  register?: (registry: ToolRegistry, emitter: AgentEmitter) => void | Promise<void>;
  default?: (registry: ToolRegistry, emitter: AgentEmitter) => void | Promise<void>;
}

export interface PluginLoadResult {
  file: string;
  ok: boolean;
  error?: string;
}

/**
 * Load all .js/.mjs plugin files from AGENT_PLUGIN_DIR and call their register() exports.
 * Silently skips if AGENT_PLUGIN_DIR is not set.
 * Returns a summary of loaded plugins and any errors.
 */
export async function loadPlugins(
  registry: ToolRegistry,
  emitter: AgentEmitter
): Promise<PluginLoadResult[]> {
  const pluginDir = effectiveHarnessEnvRaw("AGENT_PLUGIN_DIR")?.trim();
  if (!pluginDir) return [];

  if (!existsSync(pluginDir)) {
    emitter.emit("error", { err: new Error(`AGENT_PLUGIN_DIR does not exist: ${pluginDir}`) });
    return [];
  }

  let entries: string[];
  try {
    entries = readdirSync(pluginDir).filter(
      (f) => f.endsWith(".js") || f.endsWith(".mjs")
    );
  } catch (e) {
    emitter.emit("error", { err: new Error(`Cannot read AGENT_PLUGIN_DIR: ${e instanceof Error ? e.message : String(e)}`) });
    return [];
  }

  if (entries.length === 0) return [];

  const results: PluginLoadResult[] = [];

  for (const file of entries) {
    const fullPath = join(pluginDir, file);
    const fileUrl = pathToFileURL(fullPath).href;

    try {
      const mod = (await import(/* @vite-ignore */ fileUrl)) as PluginModule;

      const registerFn = mod.register ?? mod.default;
      if (typeof registerFn !== "function") {
        results.push({
          file,
          ok: false,
          error: "Plugin must export a named `register` function or a default function.",
        });
        continue;
      }

      await Promise.resolve(registerFn(registry, emitter));
      results.push({ file, ok: true });
    } catch (e) {
      results.push({
        file,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Emit a single summary event for observability
  const loaded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  if (loaded > 0 || failed > 0) {
    const summary = `Plugin loader: ${loaded} loaded, ${failed} failed from ${pluginDir}`;
    if (failed > 0) {
      const errs = results.filter((r) => !r.ok).map((r) => `  ${r.file}: ${r.error}`).join("\n");
      emitter.emit("error", { err: new Error(`${summary}\nErrors:\n${errs}`) });
    }
  }

  return results;
}
