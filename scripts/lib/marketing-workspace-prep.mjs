/**
 * Reset ephemeral paths before marketing harness runs so write_file mode=create succeeds.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const MARKETING_CAPTURE_DIR = "marketing-capture";

/** Prompt keys that write into marketing-capture/ — wipe before each run. */
const PREP_KEYS = new Set(["code-ship-test"]);

/**
 * @param {string} repoRoot
 * @param {{ key?: string; id?: string }} spec
 */
export async function prepMarketingWorkspace(repoRoot, spec) {
  const key = spec.key ?? spec.id?.replace(/^(?:desktop|live)-/, "") ?? "";
  if (!PREP_KEYS.has(key)) return;

  const captureDir = path.join(repoRoot, MARKETING_CAPTURE_DIR);
  try {
    await fs.rm(captureDir, { recursive: true, force: true });
    console.log(`[marketing] wiped ${MARKETING_CAPTURE_DIR}/ for fresh capture`);
  } catch (err) {
    console.warn(
      `[marketing] could not wipe ${MARKETING_CAPTURE_DIR}/:`,
      err instanceof Error ? err.message : err
    );
  }
}
