/**
 * Git-native tools — safe git operations without the approval gate.
 *
 * read-only tools (git_status, git_diff, git_log) are "safe".
 * git_branch / git_commit require approval (mutating). Destructive git via run_shell.
 * Destructive operations (push, reset --hard, rebase) intentionally omitted — use run_shell.
 */
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { defineTool } from "./helpers.js";

const execAsync = promisify(exec);

async function git(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`git ${cmd}`, { cwd, timeout: 15_000 });
}

// ─── git_status ───────────────────────────────────────────────────────────────

export const gitStatusTool = defineTool({
  name: "git_status",
  description:
    "WHAT: Show working tree status — staged, unstaged, and untracked files.\n" +
    "WHEN: Before committing, to check what's dirty, or to understand the current repo state.\n" +
    "ARGS: cwd — optional working directory (defaults to CWD from world context).",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: false,
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (optional)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = args["cwd"] as string | undefined;
    try {
      const { stdout, stderr } = await git("status", cwd);
      const out = stdout.trim() || stderr.trim() || "(nothing to report)";
      return { ok: true, output: out };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

// ─── git_diff ────────────────────────────────────────────────────────────────

export const gitDiffTool = defineTool({
  name: "git_diff",
  description:
    "WHAT: Show diff of working tree vs HEAD (or diff of a specific file).\n" +
    "WHEN: Before committing to see exactly what changed, or to understand a change.\n" +
    "ARGS: path — optional file/dir to diff; staged — if true, show staged diff; cwd — optional working directory.",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: false,
  parameters: {
    type: "object",
    properties: {
      path: { type: "string", description: "File or directory to diff (optional — omit for full diff)" },
      staged: { type: "string", enum: ["true", "false"], description: "Show staged diff (default: false)" },
      cwd: { type: "string", description: "Working directory (optional)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = args["cwd"] as string | undefined;
    const path = args["path"] as string | undefined;
    const staged = args["staged"] === "true";
    const stagedFlag = staged ? "--staged " : "";
    const pathArg = path ? `-- "${path}"` : "";
    try {
      const { stdout, stderr } = await git(`diff ${stagedFlag}${pathArg}`, cwd);
      const out = stdout.trim() || "(no diff)";
      return { ok: true, output: out };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

// ─── git_log ──────────────────────────────────────────────────────────────────

export const gitLogTool = defineTool({
  name: "git_log",
  description:
    "WHAT: Show recent commit history with hash, author, date, and message.\n" +
    "WHEN: To understand recent changes, find a commit hash, or check branch history.\n" +
    "ARGS: n — number of commits (default: 10); path — optional file to filter log by; cwd — optional working directory.",
  requiresApproval: false,
  dangerLevel: "safe",
  cacheable: false,
  parameters: {
    type: "object",
    properties: {
      n: { type: "number", minimum: 1, maximum: 100, description: "Number of commits (default: 10)" },
      path: { type: "string", description: "Filter to commits touching this file (optional)" },
      cwd: { type: "string", description: "Working directory (optional)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = args["cwd"] as string | undefined;
    const n = (args["n"] as number | undefined) ?? 10;
    const path = args["path"] as string | undefined;
    const pathArg = path ? `-- "${path}"` : "";
    try {
      const { stdout } = await git(
        `log --oneline --decorate -${n} ${pathArg}`,
        cwd
      );
      return { ok: true, output: stdout.trim() || "(no commits)" };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

// ─── git_branch ───────────────────────────────────────────────────────────────

export const gitBranchTool = defineTool({
  name: "git_branch",
  description:
    "WHAT: List all branches, or create/switch to a new branch.\n" +
    "WHEN: To see what branches exist, or to create a new feature branch.\n" +
    "NOT WHEN: Deleting branches — use run_shell.\n" +
    "ARGS: name — branch name to create+switch to (omit to list branches); cwd — optional working directory.",
  requiresApproval: true,
  dangerLevel: "cautious",
  cacheable: false,
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "Branch name to create and switch to (optional — omit to list)" },
      cwd: { type: "string", description: "Working directory (optional)" },
    },
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = args["cwd"] as string | undefined;
    const name = args["name"] as string | undefined;
    try {
      if (name) {
        const { stdout, stderr } = await git(`checkout -b "${name}"`, cwd);
        return { ok: true, output: (stdout + stderr).trim() };
      } else {
        const { stdout } = await git("branch -a", cwd);
        return { ok: true, output: stdout.trim() || "(no branches)" };
      }
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});

// ─── git_commit ───────────────────────────────────────────────────────────────

export const gitCommitTool = defineTool({
  name: "git_commit",
  description:
    "WHAT: Stage specific files and create a commit.\n" +
    "WHEN: After completing a logical unit of work, to save progress with a meaningful message.\n" +
    "NOT WHEN: Pushing to remote — use run_shell for git push.\n" +
    "ARGS: message — commit message; files — array of file paths to stage (required); cwd — optional working directory.",
  requiresApproval: true,
  dangerLevel: "cautious",
  parameters: {
    type: "object",
    properties: {
      message: { type: "string", minLength: 1, description: "Commit message" },
      files: {
        type: "array",
        items: { type: "string" },
        description: "File paths to stage before committing",
      },
      cwd: { type: "string", description: "Working directory (optional)" },
    },
    required: ["message", "files"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const cwd = args["cwd"] as string | undefined;
    const message = args["message"] as string;
    const files = args["files"] as string[];
    if (files.length === 0) {
      return { ok: false, error: "No files specified. Provide at least one file path to stage." };
    }
    try {
      // Stage files
      const fileList = files.map((f) => `"${f}"`).join(" ");
      await git(`add ${fileList}`, cwd);
      // Commit
      const safeMsg = message.replace(/"/g, '\\"');
      const { stdout, stderr } = await git(`commit -m "${safeMsg}"`, cwd);
      return { ok: true, output: (stdout + "\n" + stderr).trim() };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
});
