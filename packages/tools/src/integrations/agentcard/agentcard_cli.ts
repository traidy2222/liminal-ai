/**
 * AgentCard CLI runner — wraps the `agentcard` npm global binary.
 */
import { spawn } from "node:child_process";
import { effectiveHarnessEnvRaw } from "@liminal/core";

export function agentcardEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_AGENTCARD") !== "0";
}

/** Match user/agent mentions of AgentCard (incl. "agent card" with a space). */
export function matchesAgentcardIntent(text: string): boolean {
  return /agent\s*card|agentcard(?:\.ai)?|virtual card|x402|pay online|prepaid card|single-use card/i.test(
    text
  );
}

export function resolveAgentcardCommand(): string {
  return effectiveHarnessEnvRaw("AGENT_AGENTCARD_CMD")?.trim() || "agentcard";
}

function parseTimeoutMs(key: string, fallback: number, max: number): number {
  const raw = effectiveHarnessEnvRaw(key)?.trim();
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(5_000, Math.min(max, n));
}

export function resolveAgentcardTimeoutMs(): number {
  return parseTimeoutMs("AGENT_AGENTCARD_TIMEOUT_MS", 120_000, 600_000);
}

export function resolveAgentcardSignupTimeoutMs(): number {
  return parseTimeoutMs("AGENT_AGENTCARD_SIGNUP_TIMEOUT_MS", 330_000, 600_000);
}

export type AgentcardExecResult =
  | { ok: true; stdout: string; stderr: string; exitCode: number }
  | { ok: false; error: string };

export async function execAgentcard(
  args: string[],
  opts?: { timeoutMs?: number; cwd?: string }
): Promise<AgentcardExecResult> {
  const cmd = resolveAgentcardCommand();
  const timeoutMs = opts?.timeoutMs ?? resolveAgentcardTimeoutMs();

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts?.cwd,
      env: process.env,
      shell: process.platform === "win32",
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const finish = (result: AgentcardExecResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish({
        ok: false,
        error: `agentcard timed out after ${timeoutMs}ms (command: ${cmd} ${args.join(" ")})`,
      });
    }, timeoutMs);

    child.on("error", (err) => {
      finish({
        ok: false,
        error:
          err.message.includes("ENOENT") || /not found/i.test(err.message)
            ? `\`agentcard\` not found. Install: npm install -g agentcard (or set AGENT_AGENTCARD_CMD).`
            : err.message,
      });
    });

    child.on("close", (code) => {
      const exitCode = code ?? 1;
      const out = stdout.trim();
      const errOut = stderr.trim();
      if (exitCode !== 0) {
        finish({
          ok: false,
          error: [errOut, out].filter(Boolean).join("\n").trim() || `agentcard exited ${exitCode}`,
        });
        return;
      }
      finish({ ok: true, stdout: out, stderr: errOut, exitCode });
    });
  });
}

/** Round checkout dollars up to next whole dollar, clamp 1–150. */
export function normalizeAgentcardCardAmount(raw: unknown): { ok: true; amount: number } | { ok: false; error: string } {
  const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
  if (!Number.isFinite(n) || n <= 0) {
    return { ok: false, error: "amount must be a positive number (USD dollars)" };
  }
  const amount = Math.ceil(n);
  if (amount < 1 || amount > 150) {
    return {
      ok: false,
      error: "card amount must be 1–150 USD (beta cap). Round checkout total up; ask user if over 150.",
    };
  }
  return { ok: true, amount };
}

export function formatAgentcardOutput(res: Extract<AgentcardExecResult, { ok: true }>): string {
  const parts = [res.stdout, res.stderr].filter(Boolean);
  const text = parts.join("\n").trim();
  return (
    text ||
    "[agentcard completed with no stdout — check agentcard whoami / limit if this was unexpected]"
  );
}
