import { effectiveHarnessEnvRaw } from "../harness_effective_env.js";

/** Master switch for spawn_app / desktop widget tools (default off until stable). */
export function liminalAppsEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_LIMINAL_APPS") !== "0";
}

/** Sidecar injects desktop widget protocol when this is on (requires liminalAppsEnabled). */
export function liminalAppsDesktopRuntime(): boolean {
  return liminalAppsEnabled() && effectiveHarnessEnvRaw("AGENT_LIMINAL_APPS_DESKTOP") === "1";
}
