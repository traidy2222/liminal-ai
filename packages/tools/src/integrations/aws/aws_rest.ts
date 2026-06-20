/**
 * AWS REST helpers — CLI-backed where SDK is not bundled.
 */
import { defaultAwsMcpEndpoint, effectiveHarnessEnvRaw } from "@liminal/core";

export function awsRestEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_AWS_REST") !== "0";
}

export function awsMcpEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_AWS_MCP") !== "0";
}

export function awsMcpEndpoint(region?: string): string {
  const override = effectiveHarnessEnvRaw("AGENT_AWS_MCP_ENDPOINT")?.trim();
  if (override) return override;
  return defaultAwsMcpEndpoint(region);
}
