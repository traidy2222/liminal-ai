/**
 * Run TypeScript / ESLint-style checks with optional structured diagnostics.
 */
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { resolveWorkspaceRoot } from "@liminal/core";
import { defineTool } from "./helpers.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 300_000;

type LintSeverity = "error" | "warning";
type LintMode = "tsc" | "eslint" | "command";

interface LintDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: LintSeverity;
  code: string;
  message: string;
  source: LintMode;
}

interface LintEnvelope {
  mode: LintMode;
  cwd: string;
  diagnostics: LintDiagnostic[];
  summary: {
    total: number;
    errors: number;
    warnings: number;
    files: number;
  };
  raw_excerpt?: string;
}

function summarizeDiagnostics(diags: LintDiagnostic[]) {
  const files = new Set<string>();
  let errors = 0;
  let warnings = 0;
  for (const d of diags) {
    files.add(d.file);
    if (d.severity === "error") errors++;
    else warnings++;
  }
  return { total: diags.length, errors, warnings, files: files.size };
}

function clampOut(s: string, max = 60_000) {
  return s.slice(0, max);
}

function parseTscDiagnostics(raw: string): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  const lines = raw.split(/\r?\n/);
  const re = /^(.*)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)$/i;
  for (const line of lines) {
    const m = line.match(re);
    if (!m) continue;
    out.push({
      file: m[1]!.trim(),
      line: Number(m[2]!),
      column: Number(m[3]!),
      severity: m[4]!.toLowerCase() === "warning" ? "warning" : "error",
      code: m[5]!.trim(),
      message: m[6]!.trim(),
      source: "tsc",
    });
  }
  return out;
}

function parseEslintDiagnostics(rawJson: string): LintDiagnostic[] {
  try {
    const parsed = JSON.parse(rawJson) as Array<{
      filePath?: string;
      messages?: Array<{
        line?: number;
        column?: number;
        severity?: number;
        ruleId?: string | null;
        message?: string;
      }>;
    }>;
    const out: LintDiagnostic[] = [];
    for (const file of parsed) {
      const filePath = file.filePath ?? "(unknown)";
      for (const msg of file.messages ?? []) {
        out.push({
          file: filePath,
          line: msg.line ?? 1,
          column: msg.column ?? 1,
          severity: (msg.severity ?? 2) >= 2 ? "error" : "warning",
          code: msg.ruleId ?? "eslint",
          message: (msg.message ?? "").trim() || "ESLint issue",
          source: "eslint",
        });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function parseGenericDiagnostics(raw: string): LintDiagnostic[] {
  const out: LintDiagnostic[] = [];
  // Generic matcher: file:line:col: severity code: message
  const re = /^(.*?):(\d+):(\d+):\s*(error|warning)\s*([A-Za-z0-9._-]+)?\s*:?\s*(.+)$/i;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    out.push({
      file: m[1]!.trim(),
      line: Number(m[2]!),
      column: Number(m[3]!),
      severity: m[4]!.toLowerCase() === "warning" ? "warning" : "error",
      code: (m[5] ?? "command").trim(),
      message: m[6]!.trim(),
      source: "command",
    });
  }
  return out;
}

async function runAllowedCommand(
  command: string,
  commandArgs: string[],
  cwd: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      cwd,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`command timed out after ${DEFAULT_TIMEOUT_MS}ms`));
    }, DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (d: Buffer | string) => {
      stdout += String(d);
    });
    child.stderr.on("data", (d: Buffer | string) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function lintEnvelopeOutput(
  mode: LintMode,
  cwd: string,
  diagnostics: LintDiagnostic[],
  raw: string,
  structured: boolean
): string {
  const envelope: LintEnvelope = {
    mode,
    cwd,
    diagnostics,
    summary: summarizeDiagnostics(diagnostics),
    raw_excerpt: clampOut(raw, 10_000),
  };
  if (structured) return JSON.stringify(envelope, null, 2);
  if (envelope.summary.total === 0) return `(${mode} ok)`;
  return (
    `${mode}: ${envelope.summary.errors} error(s), ${envelope.summary.warnings} warning(s), ` +
    `${envelope.summary.files} file(s)\n${clampOut(raw, 40_000)}`
  );
}

export const runLintTool = defineTool({
  name: "run_lint",
  description:
    "WHAT: Run `npx tsc --noEmit`, `npx eslint --format json`, or an allowlisted lint command.\n" +
    "WHEN: Static validation after code edits.\n" +
    "ARGS: cwd required; mode = tsc | eslint | command; format = text | structured.",
  requiresApproval: true,
  dangerLevel: "cautious",
  resourceLocks: (args) => [`shell:${(args["cwd"] as string | undefined) ?? "cwd"}`],
  parameters: {
    type: "object",
    properties: {
      cwd: { type: "string", description: "Working directory (required)" },
      mode: { type: "string", enum: ["tsc", "eslint", "command"], description: "Check mode (default tsc)" },
      format: { type: "string", enum: ["text", "structured"], description: "Output format (default text)" },
      project: { type: "string", description: "tsconfig path for tsc mode" },
      eslint_paths: {
        type: "array",
        items: { type: "string" },
        description: "Paths for eslint mode",
      },
      command: { type: "string", description: "Allowlisted command executable for mode=command" },
      command_args: {
        type: "array",
        items: { type: "string" },
        description: "Command arguments for mode=command",
      },
    },
    required: ["cwd"],
    additionalProperties: false,
  },
  handler: async (args, emit) => {
    const cwd = path.resolve(resolveWorkspaceRoot(), args["cwd"] as string);
    const mode = (((args["mode"] as string | undefined) ?? "tsc").toLowerCase() as LintMode);
    emit?.(`\nrun_lint: ${mode} in ${cwd}\n`);
    const structured = ((args["format"] as string | undefined) ?? "text").toLowerCase() === "structured";
    const npx = process.platform === "win32" ? "npx.cmd" : "npx";
    try {
      if (mode === "eslint") {
        const paths = (args["eslint_paths"] as string[] | undefined)?.length
          ? (args["eslint_paths"] as string[])
          : ["."];
        const { stdout, stderr } = await execFileAsync(
          npx,
          ["eslint", "--format", "json", ...paths],
          { cwd, maxBuffer: 6_000_000, timeout: DEFAULT_TIMEOUT_MS }
        );
        const raw = (stdout || stderr).trim();
        const diagnostics = parseEslintDiagnostics(raw);
        return { ok: true, output: lintEnvelopeOutput("eslint", cwd, diagnostics, raw, structured) };
      }
      if (mode === "command") {
        const cmd = (args["command"] as string | undefined)?.trim();
        if (!cmd) return { ok: false, error: 'mode="command" requires "command"' };
        const allow = (process.env["AGENT_LINT_ALLOWED_COMMANDS"] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        if (allow.length === 0) {
          return { ok: false, error: "command lint mode is disabled: AGENT_LINT_ALLOWED_COMMANDS is empty" };
        }
        if (!allow.includes(cmd)) {
          return { ok: false, error: `command "${cmd}" not allowlisted; allowed: ${allow.join(", ")}` };
        }
        const commandArgs = ((args["command_args"] as string[] | undefined) ?? []).map(String);
        const r = await runAllowedCommand(cmd, commandArgs, cwd);
        const raw = `${r.stdout}\n${r.stderr}`.trim();
        const diagnostics = parseGenericDiagnostics(raw);
        const output = lintEnvelopeOutput("command", cwd, diagnostics, raw, structured);
        return r.exitCode === 0 ? { ok: true, output } : { ok: false, error: output };
      }

      const proj = args["project"] as string | undefined;
      const argv = ["tsc", "--noEmit"];
      if (proj) argv.push("-p", proj);
      const { stdout, stderr } = await execFileAsync(npx, argv, {
        cwd,
        maxBuffer: 6_000_000,
        timeout: DEFAULT_TIMEOUT_MS,
      });
      const raw = (stdout + "\n" + stderr).trim();
      const diagnostics = parseTscDiagnostics(raw);
      return { ok: true, output: lintEnvelopeOutput("tsc", cwd, diagnostics, raw, structured) };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
      const out = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.trim();
      const diagnostics =
        mode === "eslint"
          ? parseEslintDiagnostics(out)
          : mode === "command"
          ? parseGenericDiagnostics(out)
          : parseTscDiagnostics(out);
      const rendered = lintEnvelopeOutput(mode, cwd, diagnostics, out, structured);
      return {
        ok: false,
        error: `lint exit ${e.code ?? "?"}: ${e.message ?? String(err)}\n${rendered}`,
      };
    }
  },
});
