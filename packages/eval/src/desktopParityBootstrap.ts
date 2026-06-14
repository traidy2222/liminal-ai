/**
 * Desktop-parity harness env — mirrors liminald defaults without sandbox lab trims.
 * Isolated fixture workspace only; does not copy SANDBOX_SPEED_ENV or AGENT_YOLO.
 */
export function desktopParityLabEnv(root: string): Record<string, string> {
  return {
    AGENT_WORKSPACE_ROOT: root,
    /** Keep notes inside the fixture temp tree for eval isolation. */
    AGENT_STORAGE_LAYOUT: "legacy",
    AGENT_TOOL_LAZY: "1",
    /** Skip first-run persona modal during automated runs. */
    AGENT_PERSONA_BOOTSTRAP: "0",
  };
}

/** Same boot-time env liminald applies (see packages/sidecar/src/index.ts). */
export function applyDesktopSidecarBootEnv(): void {
  process.env["LIMINAL_SIDECAR"] = "1";
  if (!process.env["AGENT_LATENCY_MODE"]?.trim()) {
    process.env["AGENT_LATENCY_MODE"] = "1";
  }
}

export const DESKTOP_PARITY_HARNESS_SNAPSHOT = {
  workingStateEnabled: true,
  modelMaxTokens: 128_000,
  thresholdFraction: 0.6,
  maxToolRoundsPerTurn: 128,
  transport: "SessionBridge",
} as const;
