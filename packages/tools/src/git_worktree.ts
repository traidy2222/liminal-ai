/**
 * git_worktree — manage linked git worktrees so isolated work (or, later,
 * parallel sub-agents) can edit a separate checkout without contending on the
 * main working tree's file:write resource locks.
 *
 * Worktrees are created under `.agent_worktrees/<label>` (gitignored) on a
 * dedicated `agent/<label>` branch. The model can point run_shell / file tools
 * at the returned path, work in isolation, then merge the branch back.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, timeout: 30_000 });
  return stdout;
}

/** Reduce a label to a filesystem/branch-safe slug. */
function sanitizeLabel(label: string): string {
  return label.replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 50);
}

export const gitWorktreeTool = defineTool({
  name: "git_worktree",
  description:
    "WHAT: Manage linked git worktrees — isolated checkouts that share the repo " +
    "but have their own working directory and branch.\n" +
    "WHEN: To do risky or parallel work off the main tree (e.g. a sub-agent task), " +
    "then merge the branch back.\n" +
    "NOT WHEN: Not a git repo; small in-place edits (just use edit_file).\n" +
    "ARGS: action — add | list | remove.\n" +
    "  add: label (required), branch (default agent/<label>), base (optional start ref).\n" +
    "  remove: label (required), force (drop even if dirty), delete_branch.\n" +
    "  cwd — repo root (default workspace root).",
  requiresApproval: false,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["add", "list", "remove"], description: "Worktree operation" },
      label: { type: "string", description: "Worktree name (add/remove) — becomes .agent_worktrees/<label>" },
      branch: { type: "string", description: "Branch name (add/remove); default agent/<label>" },
      base: { type: "string", description: "Start ref for the new branch (add only); default current HEAD" },
      force: { type: "boolean", description: "remove: drop the worktree even if it has uncommitted changes" },
      delete_branch: { type: "boolean", description: "remove: also delete the worktree's branch" },
      cwd: { type: "string", description: "Repo root (default workspace root)" },
    },
    required: ["action"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const action = args["action"] as "add" | "list" | "remove";
    const repoRoot = path.resolve(resolveWorkspaceRoot(), (args["cwd"] as string | undefined) ?? ".");

    try {
      if (action === "list") {
        const out = await runGit(["worktree", "list", "--porcelain"], repoRoot);
        return { ok: true, output: out.trim() || "(no worktrees)" };
      }

      const rawLabel = (args["label"] as string | undefined)?.trim();
      if (!rawLabel) {
        return { ok: false, error: `action "${action}" requires a "label"` };
      }
      const label = sanitizeLabel(rawLabel);
      if (!label) {
        return { ok: false, error: `label "${rawLabel}" is empty after sanitizing` };
      }
      const wtPath = path.join(repoRoot, ".agent_worktrees", label);
      const branch = (args["branch"] as string | undefined)?.trim() || `agent/${label}`;

      if (action === "add") {
        const base = (args["base"] as string | undefined)?.trim();
        const gitArgs = ["worktree", "add", "-b", branch, wtPath];
        if (base) gitArgs.push(base);
        try {
          await runGit(gitArgs, repoRoot);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            ok: false,
            error:
              `git worktree add failed: ${msg}\n` +
              `If branch "${branch}" already exists, pass a different "branch", ` +
              `or remove the existing worktree/branch first.`,
          };
        }
        return {
          ok: true,
          output:
            `Worktree created at ${wtPath}\n` +
            `Branch: ${branch}\n` +
            `Run tools with cwd="${wtPath}" to work in isolation. ` +
            `Merge back with: git merge ${branch} (from the main tree).`,
        };
      }

      // action === "remove"
      const force = (args["force"] as boolean | undefined) ?? false;
      const removeArgs = ["worktree", "remove", wtPath];
      if (force) removeArgs.push("--force");
      try {
        await runGit(removeArgs, repoRoot);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          ok: false,
          error:
            `git worktree remove failed: ${msg}\n` +
            `The worktree may have uncommitted changes — retry with force:true to discard them.`,
        };
      }
      let branchNote = "";
      if ((args["delete_branch"] as boolean | undefined) ?? false) {
        try {
          await runGit(["branch", "-D", branch], repoRoot);
          branchNote = `\nBranch "${branch}" deleted.`;
        } catch (err) {
          branchNote = `\nWorktree removed, but branch "${branch}" delete failed: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }
      return { ok: true, output: `Worktree "${label}" removed (${wtPath}).${branchNote}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `git_worktree ${action} failed: ${msg}` };
    }
  },
});
