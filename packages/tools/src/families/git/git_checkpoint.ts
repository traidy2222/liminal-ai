/**
 * Harness-level git checkpoint/rollback.
 *
 * Before any plan execution that touches files, git_checkpoint creates a stash
 * snapshot. If the plan fails (contract drift > threshold or user request),
 * git_rollback restores from that stash — giving plan-level atomicity instead
 * of per-tool rollback.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "../../shared/helpers.js";

const execFileAsync = promisify(execFile);

async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, timeout: 30_000 });
}

function sanitizeLabel(label: string): string {
  return label.replace(/[^a-z0-9_-]/gi, "-").slice(0, 60);
}

export const gitCheckpointTool = defineTool({
  name: "git_checkpoint",
  description:
    "WHAT: Create a git stash snapshot before a plan execution that modifies files.\n" +
    "WHEN: Before running a multi-step plan (especially with write_file / edit_file).\n" +
    "NOT WHEN: Working in a non-git directory, or when changes are already stashed.\n" +
    "ARGS: label — short description of what the checkpoint protects; cwd — optional working directory.",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      label: {
        type: "string",
        description: "Short description of the checkpoint (e.g. 'before-auth-refactor')",
      },
      cwd: {
        type: "string",
        description: "Working directory (default: repo root)",
      },
    },
    required: ["label"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const label = sanitizeLabel(args["label"] as string);
    const cwd = (args["cwd"] as string | undefined)?.trim() || ".";
    const stashMsg = `agent-checkpoint-${label}-${Date.now()}`;
    try {
      // Include untracked files so even new files are covered
      const { stdout } = await runGit(
        ["stash", "push", "--include-untracked", "-m", stashMsg],
        cwd
      );
      if (stdout.trim() === "No local changes to save") {
        return {
          ok: true,
          output: `No uncommitted changes — checkpoint not needed. (stash label would have been: ${stashMsg})`,
        };
      }
      return {
        ok: true,
        output:
          `Checkpoint created: "${stashMsg}"\n` +
          `Call git_rollback({ stash_label: "${stashMsg}" }) to restore this state.`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `git stash failed: ${msg}` };
    }
  },
});

export const gitRollbackTool = defineTool({
  name: "git_rollback",
  description:
    "WHAT: Restore files to a previous git_checkpoint by popping a named stash.\n" +
    "WHEN: After a plan fails mid-way and you need to undo all edits back to the checkpoint.\n" +
    "NOT WHEN: The checkpoint was never created, or you want to keep partial changes.\n" +
    "ARGS: stash_label — the stash message from git_checkpoint output; cwd — optional working directory.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      stash_label: {
        type: "string",
        description: "Stash message returned by git_checkpoint",
      },
      cwd: {
        type: "string",
        description: "Working directory (default: repo root)",
      },
    },
    required: ["stash_label"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const label = args["stash_label"] as string;
    const cwd = (args["cwd"] as string | undefined)?.trim() || ".";
    try {
      // Find the stash index matching the label
      const { stdout: listOut } = await runGit(["stash", "list"], cwd);
      const lines = listOut.trim().split("\n");
      const matchLine = lines.find((l) => l.includes(label));
      if (!matchLine) {
        return {
          ok: false,
          error:
            `No stash found matching label "${label}".\n` +
            `Available stashes:\n${lines.slice(0, 10).join("\n")}`,
        };
      }
      // Extract stash ref e.g. "stash@{0}"
      const refMatch = matchLine.match(/^(stash@\{\d+\})/);
      if (!refMatch) {
        return { ok: false, error: `Could not parse stash ref from: ${matchLine}` };
      }
      const ref = refMatch[1]!;
      // Use pop (restores and drops the stash entry)
      const { stdout: popOut } = await runGit(["stash", "pop", ref], cwd);
      return {
        ok: true,
        output: `Rolled back to checkpoint "${label}" (${ref}).\n${popOut.trim()}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `git rollback failed: ${msg}` };
    }
  },
});
