/**
 * Append-only failure / diagnostics log (AGENT_FAILURE_LOG=1).
 */
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { resolveWorkspaceRoot } from "./workspace_root.js";

const FAILURE_PATH = () => join(resolveWorkspaceRoot(), ".agent_failures.jsonl");

export async function appendFailureLog(entry: Record<string, unknown>): Promise<void> {
  if (process.env["AGENT_FAILURE_LOG"] !== "1") return;
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n";
    await mkdir(resolveWorkspaceRoot(), { recursive: true });
    await appendFile(FAILURE_PATH(), line, "utf8");
  } catch {
    /* best-effort */
  }
}

export function failureLogPath(): string {
  return FAILURE_PATH();
}
