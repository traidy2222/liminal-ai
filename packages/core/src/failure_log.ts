/**
 * Append-only failure / diagnostics log (AGENT_FAILURE_LOG=1).
 *
 * Phase 1 storage split: writes go to `~/.liminal/failures.jsonl`. Falls back
 * to the legacy `.agent_failures.jsonl` under the workspace root when the
 * global file doesn't exist yet (one-shot migration on first write). Set
 * `AGENT_STORAGE_LAYOUT=legacy` to disable the split.
 */
import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import {
  ensureGlobalStorageRoot,
  failureLogPaths,
  pickReadPath,
  pickWritePath,
} from "./global_storage.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

export async function appendFailureLog(entry: Record<string, unknown>): Promise<void> {
  if (effectiveHarnessEnvRaw("AGENT_FAILURE_LOG") !== "1") return;
  try {
    const line = JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n";
    await ensureGlobalStorageRoot();
    const target = await pickWritePath(failureLogPaths());
    await mkdir(path.dirname(target), { recursive: true });
    await appendFile(target, line, "utf8");
  } catch {
    /* best-effort */
  }
}

/** Synchronous reference to the legacy path — used by docs / pretty-printing. */
export function failureLogPath(): string {
  return failureLogPaths().legacy;
}

/** Async — returns the path the harness currently reads from. */
export async function failureLogReadPath(): Promise<string> {
  return pickReadPath(failureLogPaths());
}
