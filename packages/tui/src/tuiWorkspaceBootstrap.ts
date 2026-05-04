/**
 * Must be imported before `@liminal/core` / `@liminal/tools` so `AGENT_WORKSPACE_ROOT`
 * and process cwd match the monorepo root (not `packages/tui`).
 */
import { config } from "dotenv";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const tuiSrcDir = dirname(fileURLToPath(import.meta.url));
config({ path: join(tuiSrcDir, "../../../.env") });

const repoRoot = join(tuiSrcDir, "../../..");
const targetRoot = resolve(process.env["AGENT_WORKSPACE_ROOT"]?.trim() || repoRoot);
process.env["AGENT_WORKSPACE_ROOT"] = targetRoot;
try {
  process.chdir(targetRoot);
} catch {
  /* ignore — env still grounds world context */
}
