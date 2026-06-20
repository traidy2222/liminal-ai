/**
 * AWS workspace connect — IAM credentials + AWS MCP Server (SigV4).
 */
import type { ToolRegistry } from "@liminal/core";
import {
  AWS_MCP_CONNECTION,
  resolveAwsServices,
  saveAwsIdentityAccount,
  listAwsIdentityAccounts,
  clearAwsIdentityAccounts,
  tryAwsStsGetCallerIdentity,
  awsProfileFromEnv,
  awsRegionFromEnv,
} from "@liminal/core";
import {
  deleteConnection,
  listConnectionsByParent,
  readConnection,
} from "../external_api/api_connections_store.js";
import { attachMcpConnection, unregisterMcpConnection } from "../external_api/mcp_attach.js";
import { awsIamAuthScheme } from "./aws_sigv4_fetch.js";
import { awsMcpEnabled, awsMcpEndpoint, awsRestEnabled } from "./aws_rest.js";

export const AWS_PARENT_PROVIDER = "aws";

export async function connectAwsFromServer(
  registry: ToolRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only"; profile?: string }
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const mode = opts.mode ?? "read_write";
  const readOnly = mode === "read_only";
  const presets = resolveAwsServices(opts.services);
  if (presets.length === 0) {
    return { ok: false, error: "no valid services in services[]" };
  }

  const identity = await tryAwsStsGetCallerIdentity(opts.profile);
  if (!identity) {
    return {
      ok: false,
      error:
        "No AWS credentials. Run `aws configure` or `aws sso login`, or set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY in .env.",
    };
  }

  const region = awsRegionFromEnv();
  const profile = opts.profile ?? awsProfileFromEnv();
  await saveAwsIdentityAccount(identity, { profile, region });

  const attached: string[] = [];
  let totalTools = 0;
  const attachErrors: string[] = [];

  if (awsMcpEnabled() && presets.some((p) => p.backend === "aws_mcp")) {
    try {
      const endpoint = awsMcpEndpoint(region);
      const { registered } = await attachMcpConnection(registry, {
        name: AWS_MCP_CONNECTION,
        url: endpoint,
        auth: awsIamAuthScheme({ region, profile }),
        readOnly,
        providerId: "aws_mcp",
        parentProvider: AWS_PARENT_PROVIDER,
        services: presets.map((p) => p.id),
        oauthAccountId: identity.accountId,
      });
      attached.push(AWS_MCP_CONNECTION);
      totalTools += registered.length;
    } catch (e) {
      attachErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  const label = identity.arn.split("/").pop() ?? identity.accountId;
  const restNote = `REST tools: ${awsRestEnabled() ? "on" : "off (AGENT_AWS_REST=1)"}`;
  const mcpNote = `MCP: ${awsMcpEnabled() ? endpointSummary(region) : "off (AGENT_AWS_MCP=1)"}`;

  if (attached.length === 0 && attachErrors.length > 0) {
    return {
      ok: false,
      error: attachErrors.join("\n\n"),
    };
  }

  const partial = attachErrors.length > 0 ? `\n\nSkipped:\n${attachErrors.join("\n")}` : "";
  return {
    ok: true,
    output:
      `Connected AWS as ${label} (${identity.accountId}, ${mode}).\n` +
      `Services: ${presets.map((p) => p.id).join(", ")}\n` +
      `Tools attached: ${totalTools}\n` +
      `${restNote}\n${mcpNote}` +
      partial,
  };
}

function endpointSummary(region: string): string {
  return awsMcpEndpoint(region);
}

export async function disconnectAwsFromServer(
  registry: ToolRegistry | ToolRegistry[],
  clearIdentity = false
): Promise<{ ok: boolean; output?: string; error?: string }> {
  const registries = Array.isArray(registry) ? registry : [registry];
  const conns = await listConnectionsByParent(AWS_PARENT_PROVIDER);
  for (const c of conns) {
    if (c.kind !== "mcp") continue;
    for (const reg of registries) {
      await unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
  }
  if (clearIdentity) {
    await clearAwsIdentityAccounts();
  }
  return {
    ok: true,
    output: `Disconnected AWS${clearIdentity ? " (identity cleared)" : ""}.`,
  };
}

export async function awsIdentityReady(): Promise<boolean> {
  const accounts = await listAwsIdentityAccounts();
  if (accounts.length > 0) return true;
  return (await tryAwsStsGetCallerIdentity()) != null;
}

export async function awsMcpAttached(): Promise<boolean> {
  const conn = await readConnection(AWS_MCP_CONNECTION);
  return conn?.kind === "mcp" && conn.parentProvider === AWS_PARENT_PROVIDER;
}

export async function getAwsIntegrationStatus(): Promise<{
  enabled: boolean;
  running: boolean;
  port: number;
  url: string;
  error?: string;
}> {
  const region = awsRegionFromEnv();
  const attached = await awsMcpAttached();
  const endpoint = awsMcpEndpoint(region);
  return {
    enabled: awsMcpEnabled(),
    running: attached,
    port: 0,
    url: endpoint,
  };
}
