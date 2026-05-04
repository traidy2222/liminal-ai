/**
 * Import before `@liminal/core` so eval harness + `.agent_eval_runs` use monorepo root.
 */
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const evalSrcDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(evalSrcDir, "../../../");
const targetRoot = resolve(process.env["AGENT_WORKSPACE_ROOT"]?.trim() || repoRoot);
process.env["AGENT_WORKSPACE_ROOT"] = targetRoot;
try {
  process.chdir(targetRoot);
} catch {
  /* ignore */
}
