import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";

/** Directories skipped during the walk unless explicitly targeted by `base`. */
const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  ".agent_artifacts",
  ".agent_sessions",
  ".agent_write_staging",
  ".agent_worktrees",
]);

/**
 * Translate a glob pattern into an anchored RegExp matched against workspace-
 * relative POSIX paths. Supports `**` (any path segments, incl. none), `*`
 * (any chars except `/`), and `?` (one char except `/`).
 */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // `**` — cross directory boundaries. Consume an optional trailing slash
        // so `**/x` also matches a top-level `x`.
        i++;
        if (glob[i + 1] === "/") {
          i++;
          re += "(?:.*/)?";
        } else {
          re += ".*";
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if ("\\^$.|+()[]{}".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

export const findFilesTool = defineTool({
  name: "find_files",
  description:
    "WHAT: Find files by path/name glob across the workspace (e.g. '**/*.test.ts', 'src/**/index.*').\n" +
    "WHEN: Locating files by name or extension when you don't know the exact path. Complements grep_file (content) and list_dir (one level).\n" +
    "NOT WHEN: Searching file *contents* — use grep_file. Listing a single known directory — use list_dir.\n" +
    "ARGS: pattern — glob matched against workspace-relative paths (** = any dirs, * = any chars, ? = one char). base — subdir to start from (default workspace root). max_results — cap (default 200). include_dirs — also match directories (default false).",
  requiresApproval: false,
  cacheable: true,
  cacheTtlMs: 15_000,
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Glob matched against workspace-relative POSIX paths, e.g. '**/*.ts'.",
      },
      base: {
        type: "string",
        description: "Subdirectory to search from (workspace-relative). Default: workspace root.",
      },
      max_results: {
        type: "number",
        minimum: 1,
        maximum: 2000,
        description: "Maximum matches to return (default 200).",
      },
      include_dirs: {
        type: "boolean",
        description: "Also match directories, not just files (default false).",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const pattern = String(args["pattern"] ?? "").trim();
    if (!pattern) return { ok: false, error: "pattern is required" };

    const baseRel = String(args["base"] ?? "").trim();
    const baseGuard = resolveWithinWorkspace(baseRel || ".");
    if (!baseGuard.ok || !baseGuard.resolvedPath) {
      return { ok: false, error: baseGuard.error ?? "invalid base path" };
    }
    const root = resolveWithinWorkspace(".").resolvedPath!;
    const baseAbs = baseGuard.resolvedPath;
    const maxResults =
      typeof args["max_results"] === "number" ? Math.max(1, Math.min(2000, args["max_results"] as number)) : 200;
    const includeDirs = Boolean(args["include_dirs"]);
    const re = globToRegExp(pattern);

    const matches: string[] = [];
    let truncated = false;

    const walk = async (dirAbs: string): Promise<void> => {
      if (matches.length >= maxResults) {
        truncated = true;
        return;
      }
      let entries: string[];
      try {
        entries = await readdir(dirAbs);
      } catch {
        return;
      }
      for (const name of entries) {
        if (matches.length >= maxResults) {
          truncated = true;
          return;
        }
        const childAbs = path.join(dirAbs, name);
        let info;
        try {
          info = await stat(childAbs);
        } catch {
          continue;
        }
        const isDir = info.isDirectory();
        if (isDir && DEFAULT_IGNORES.has(name)) continue;
        const rel = path.relative(root, childAbs).split(path.sep).join("/");
        if ((!isDir || includeDirs) && re.test(rel)) {
          matches.push(isDir ? rel + "/" : rel);
        }
        if (isDir) await walk(childAbs);
      }
    };

    await walk(baseAbs);
    matches.sort();

    if (matches.length === 0) {
      return { ok: true, output: `No files match '${pattern}'.` };
    }
    const header = `${matches.length} match${matches.length === 1 ? "" : "es"}${truncated ? ` (capped at ${maxResults})` : ""}:`;
    return { ok: true, output: `${header}\n${matches.join("\n")}` };
  },
});
