/**
 * Paths touched by workspace edit tools — used for working-memory tracking and
 * read-cache invalidation after successful mutations.
 */

const SCALAR_PATH_KEYS = [
  "path",
  "to",
  "target",
  "target_path",
  "dest",
  "destination",
  "from",
] as const;

/** Tools that mutate workspace files on success (excludes plan-only helpers). */
export const EDIT_TOOL_NAMES = new Set([
  "write_file",
  "patch_file",
  "apply_diff",
  "write_file_if_changed",
  "search_replace_file",
  "move_file",
  "copy_file",
  "copy_tree",
  "multi_file_apply",
  "edit_file",
]);

function pushUnique(out: string[], s: string): void {
  const t = s.trim();
  if (!t) return;
  if (!out.includes(t)) out.push(t);
}

/**
 * Extract workspace-relative or absolute paths from a successful edit tool call.
 */
export function collectEditToolTargetPaths(toolName: string, args: Record<string, unknown>): string[] {
  const out: string[] = [];

  if (toolName === "multi_file_apply") {
    if (Boolean(args["dry_run"])) return [];
    const ops = args["operations"];
    if (!Array.isArray(ops)) return [];
    for (const op of ops) {
      if (!op || typeof op !== "object") continue;
      const o = op as Record<string, unknown>;
      const kind = o["op"];
      if (kind === "write" || kind === "search_replace") {
        const p = o["path"];
        if (typeof p === "string") pushUnique(out, p);
      } else if (kind === "move" || kind === "copy") {
        const fr = o["from"];
        const to = o["to"];
        if (typeof fr === "string") pushUnique(out, fr);
        if (typeof to === "string") pushUnique(out, to);
      } else if (kind === "mkdir") {
        const p = o["path"];
        if (typeof p === "string") pushUnique(out, p);
      }
    }
    return out;
  }

  for (const key of SCALAR_PATH_KEYS) {
    const v = args[key];
    if (typeof v === "string") pushUnique(out, v);
  }
  const arr = args["paths"];
  if (Array.isArray(arr)) {
    for (const it of arr) {
      if (typeof it === "string") pushUnique(out, it);
    }
  }
  return out;
}
