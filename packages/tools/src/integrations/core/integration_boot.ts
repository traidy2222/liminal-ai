/**
 * Deferred connector boot — sidecar spawn + MCP attach must not block harness init.
 */
import type { AgentEmitter, AgentHarness, ToolRegistry } from "@liminal/core";

/** Run Google/GitHub/Microsoft boot after the harness is live (non-blocking). */
export function deferIntegrationBootstrap(
  registry: ToolRegistry,
  emitter: AgentEmitter,
  harness?: AgentHarness
): void {
  void (async () => {
    try {
      const { bootstrapGoogleWorkspace } = await import("../google/google_workspace_boot.js");
      await bootstrapGoogleWorkspace(registry);
    } catch (e) {
      emitter.emit("error", {
        err: new Error(
          `Google Workspace boot: ${e instanceof Error ? e.message : String(e)}`
        ),
      });
    }
    try {
      const { bootstrapGithub } = await import("../github/github_boot.js");
      await bootstrapGithub(registry);
    } catch (e) {
      emitter.emit("error", {
        err: new Error(`GitHub boot: ${e instanceof Error ? e.message : String(e)}`),
      });
    }
    try {
      const { bootstrapMicrosoft365 } = await import("../microsoft/microsoft_365_boot.js");
      await bootstrapMicrosoft365(registry);
    } catch (e) {
      emitter.emit("error", {
        err: new Error(
          `Microsoft 365 boot: ${e instanceof Error ? e.message : String(e)}`
        ),
      });
    }
    if (harness) {
      harness.getContext().refreshProtocolDynamic(harness.registry.getActiveToolNames());
    }
  })();
}
