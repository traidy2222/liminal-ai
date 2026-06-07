import { existsSync } from "node:fs";
import { join } from "node:path";
import { personaActivePaths } from "./global_storage.js";

/**
 * True when `runtime_profile.json` exists in global or legacy persona/active.
 * Mirrors tools `getPersonaArtifactsPaths` resolution (canonical persona on disk).
 */
export function hasPersistedPersonaProfile(workspaceRoot?: string): boolean {
  const paths = personaActivePaths(workspaceRoot);
  if (paths.legacyOnly) {
    return existsSync(join(paths.legacy, "runtime_profile.json"));
  }
  return (
    existsSync(join(paths.global, "runtime_profile.json")) ||
    existsSync(join(paths.legacy, "runtime_profile.json"))
  );
}
