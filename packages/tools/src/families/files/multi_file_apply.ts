import { mkdir, readFile, rename, writeFile, cp } from "node:fs/promises";
import path from "node:path";
import { defineTool } from "../../shared/helpers.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";
import { checkOverwriteAllowed, commitContent, rejectIfLikelyTruncated } from "./file_write_ops.js";

type Op =
  | { op: "write"; path: string; content: string }
  | { op: "mkdir"; path: string }
  | { op: "move"; from: string; to: string }
  | { op: "copy"; from: string; to: string }
  | { op: "search_replace"; path: string; search: string; replace: string; regex?: boolean; flags?: string };

export const multiFileApplyTool = defineTool({
  name: "multi_file_apply",
  description:
    "WHAT: Apply multiple file operations atomically with rollback on failure.\n" +
    "WHEN: Coordinated refactors across many files.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      operations: {
        type: "array",
        items: { type: "object" },
        description: "Ordered operations: write|mkdir|move|copy|search_replace",
      },
      dry_run: { type: "boolean", description: "Preview only, do not mutate." },
    },
    required: ["operations"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const ops = (args["operations"] as Op[]) ?? [];
    const dryRun = Boolean(args["dry_run"]);
    const backups = new Map<string, string | null>();
    const results: string[] = [];
    try {
      for (const op of ops) {
        if (op.op === "mkdir") {
          const safe = resolveWithinWorkspace(op.path);
          if (!safe.ok || !safe.resolvedPath) throw new Error(safe.error ?? "invalid mkdir path");
          if (!dryRun) await mkdir(safe.resolvedPath, { recursive: true });
          results.push(`mkdir ${safe.resolvedPath}`);
        } else if (op.op === "write") {
          const safe = resolveWithinWorkspace(op.path);
          if (!safe.ok || !safe.resolvedPath) throw new Error(safe.error ?? "invalid write path");
          if (!backups.has(safe.resolvedPath)) {
            const prev = await readFile(safe.resolvedPath, "utf8").catch(() => null);
            backups.set(safe.resolvedPath, prev);
          }
          if (!dryRun) {
            const truncErr = rejectIfLikelyTruncated(op.content);
            if (truncErr) throw new Error(truncErr);
            if (backups.get(safe.resolvedPath) !== null) {
              const guard = await checkOverwriteAllowed(safe.resolvedPath, false);
              if (!guard.ok) throw new Error(guard.error);
            }
            await mkdir(path.dirname(safe.resolvedPath), { recursive: true });
            await commitContent(safe.resolvedPath, op.content, "overwrite");
          }
          results.push(`write ${safe.resolvedPath}`);
        } else if (op.op === "move") {
          const src = resolveWithinWorkspace(op.from);
          const dst = resolveWithinWorkspace(op.to);
          if (!src.ok || !src.resolvedPath) throw new Error(src.error ?? "invalid move src");
          if (!dst.ok || !dst.resolvedPath) throw new Error(dst.error ?? "invalid move dst");
          if (!dryRun) {
            await mkdir(path.dirname(dst.resolvedPath), { recursive: true });
            await rename(src.resolvedPath, dst.resolvedPath);
          }
          results.push(`move ${src.resolvedPath} -> ${dst.resolvedPath}`);
        } else if (op.op === "copy") {
          const src = resolveWithinWorkspace(op.from);
          const dst = resolveWithinWorkspace(op.to);
          if (!src.ok || !src.resolvedPath) throw new Error(src.error ?? "invalid copy src");
          if (!dst.ok || !dst.resolvedPath) throw new Error(dst.error ?? "invalid copy dst");
          if (!dryRun) {
            await mkdir(path.dirname(dst.resolvedPath), { recursive: true });
            await cp(src.resolvedPath, dst.resolvedPath, { recursive: false, force: true });
          }
          results.push(`copy ${src.resolvedPath} -> ${dst.resolvedPath}`);
        } else if (op.op === "search_replace") {
          const safe = resolveWithinWorkspace(op.path);
          if (!safe.ok || !safe.resolvedPath) throw new Error(safe.error ?? "invalid search_replace path");
          const content = await readFile(safe.resolvedPath, "utf8");
          if (!backups.has(safe.resolvedPath)) backups.set(safe.resolvedPath, content);
          const regex = Boolean(op.regex);
          const flags = op.flags ?? "g";
          const next = regex
            ? content.replace(new RegExp(op.search, flags.includes("g") ? flags : `${flags}g`), op.replace)
            : content.split(op.search).join(op.replace);
          if (!dryRun) await writeFile(safe.resolvedPath, next, "utf8");
          results.push(`search_replace ${safe.resolvedPath}`);
        }
      }
      return { ok: true, output: `${dryRun ? "Dry-run" : "Applied"} ${ops.length} operation(s)\n${results.join("\n")}` };
    } catch (err) {
      if (!dryRun) {
        for (const [p, prev] of backups.entries()) {
          if (prev !== null) {
            await writeFile(p, prev, "utf8").catch(() => undefined);
          }
        }
      }
      return { ok: false, error: `multi_file_apply failed; rollback attempted: ${String(err)}` };
    }
  },
});

