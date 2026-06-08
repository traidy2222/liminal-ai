import {
  ALL_GOOGLE_SERVICE_IDS,
  ALL_MICROSOFT_SERVICE_IDS,
  listGoogleOAuthAccounts,
  listMicrosoftOAuthAccounts,
  listXeroOAuthAccounts,
  missingDefaultWorkspaceScopes,
  missingDefaultMicrosoftScopes,
  runGoogleConnectFlow,
  runMicrosoftConnectFlow,
  runXeroHostedConnectFlow,
} from "@liminal/core";
import {
  attachCustomMcpFromServer,
  connectGithubFromServer,
  connectGoogleWorkspaceFromServer,
  connectMicrosoft365FromServer,
  connectXeroFromServer,
  connectOpenApiFromServer,
  detachCustomMcpFromServer,
  disconnectGithubFromServer,
  disconnectGoogleWorkspaceFromServer,
  disconnectMicrosoft365FromServer,
  disconnectXeroFromServer,
  disconnectOpenApiFromServer,
  getGoogleSidecarStatus,
  getMicrosoftSidecarStatus,
  githubTokenPresent,
  listIntegrationConnections,
  parseAuthBody,
  refreshIntegrationToolsOnRegistry,
} from "@liminal/tools";
import type { ChatRegistry } from "./chat_registry.js";

export async function buildIntegrationsSnapshot() {
  const accounts = await listGoogleOAuthAccounts();
  const msAccounts = await listMicrosoftOAuthAccounts();
  return {
    google: {
      accounts: accounts.map((a) => ({
        ...a,
        missingScopes: missingDefaultWorkspaceScopes(a.scopes),
      })),
      sidecar: await getGoogleSidecarStatus(),
      services: ALL_GOOGLE_SERVICE_IDS,
    },
    microsoft: {
      accounts: msAccounts.map((a) => ({
        ...a,
        missingScopes: missingDefaultMicrosoftScopes(a.scopes),
      })),
      sidecar: await getMicrosoftSidecarStatus(),
      services: ALL_MICROSOFT_SERVICE_IDS,
    },
    github: {
      tokenConfigured: githubTokenPresent(),
      mcpUrl: "https://api.githubcopilot.com/mcp/",
    },
    xero: {
      accounts: (await listXeroOAuthAccounts()).map((a) => ({
        accountId: a.accountId,
        email: a.email,
        scopes: a.scopes,
        expiresAt: a.expiresAt,
        tenantId: a.tenantId,
        tenantName: a.tenantName,
      })),
    },
    connections: await listIntegrationConnections(),
  };
}

function assertHarnessesIdle(registry: ChatRegistry): void {
  if (registry.anyHarnessBusy()) {
    throw new Error("Agent is busy; finish the current turn before changing integrations.");
  }
}

export async function refreshIntegrationsOnAllHarnesses(registry: ChatRegistry): Promise<void> {
  for (const bridge of registry.listBridges()) {
    const harness = bridge.harness;
    await refreshIntegrationToolsOnRegistry(harness.registry, harness.emitter);
    harness.getContext().refreshProtocolDynamic(harness.registry.getActiveToolNames());
  }
}

export async function connectGoogleOAuth(
  registry: ChatRegistry,
  opts: {
    services?: string[];
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  }
): Promise<{ email?: string; accountId: string; attachOutput?: string }> {
  const result = await runGoogleConnectFlow({
    services: opts.services,
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[google-oauth] ${m}`),
  });
  let attachOutput: string | undefined;
  if (opts.attach !== false) {
    try {
      attachOutput = await connectGoogleWorkspace(registry, {
        services: opts.services,
        mode: opts.mode ?? "read_write",
      });
    } catch (e) {
      attachOutput = `OAuth OK but MCP attach failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { email: result.email, accountId: result.accountId, attachOutput };
}

export async function connectGoogleWorkspace(
  registry: ChatRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only" }
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await connectGoogleWorkspaceFromServer(bridge.harness.registry, opts);
  if (!result.ok) throw new Error(result.error ?? "Google Workspace connect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Google Workspace tools attached.";
}

export async function connectGithub(
  registry: ChatRegistry,
  opts?: { readOnly?: boolean }
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await connectGithubFromServer(bridge.harness.registry, opts);
  if (!result.ok) throw new Error(result.error ?? "GitHub connect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "GitHub MCP tools attached.";
}

export async function disconnectGithub(registry: ChatRegistry): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectGithubFromServer(bridge.harness.registry);
  if (!result.ok) throw new Error(result.error ?? "GitHub disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "GitHub disconnected.";
}

export async function connectMicrosoftOAuth(
  registry: ChatRegistry,
  opts: {
    services?: string[];
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  }
): Promise<{ email?: string; accountId: string; attachOutput?: string }> {
  const result = await runMicrosoftConnectFlow({
    services: opts.services,
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[microsoft-oauth] ${m}`),
  });
  let attachOutput: string | undefined;
  if (opts.attach !== false) {
    try {
      attachOutput = await connectMicrosoft365(registry, {
        services: opts.services,
        mode: opts.mode ?? "read_write",
      });
    } catch (e) {
      attachOutput = `OAuth OK but MCP attach failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { email: result.email, accountId: result.accountId, attachOutput };
}

export async function connectMicrosoft365(
  registry: ChatRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only" }
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await connectMicrosoft365FromServer(bridge.harness.registry, opts);
  if (!result.ok) throw new Error(result.error ?? "Microsoft 365 connect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Microsoft 365 tools attached.";
}

export async function disconnectMicrosoft(
  registry: ChatRegistry,
  revoke: boolean
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectMicrosoft365FromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "Microsoft disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Microsoft disconnected.";
}

export async function disconnectGoogle(
  registry: ChatRegistry,
  revoke: boolean
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectGoogleWorkspaceFromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "Google disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Google disconnected.";
}

export async function connectXeroOAuth(
  registry: ChatRegistry,
  opts: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
  }
): Promise<{ email?: string; accountId: string; tenantName?: string }> {
  const result = await runXeroHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[xero-oauth] ${m}`),
  });
  try {
    assertHarnessesIdle(registry);
    const bridge = await registry.getOrCreateActive();
    await connectXeroFromServer(bridge.harness.registry);
    await refreshIntegrationsOnAllHarnesses(registry);
  } catch (e) {
    console.warn(
      "[xero-oauth] tokens saved but harness refresh failed:",
      e instanceof Error ? e.message : e
    );
  }
  return result;
}

export async function disconnectXero(registry: ChatRegistry, revoke: boolean): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectXeroFromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "Xero disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Xero disconnected.";
}

export async function attachIntegrationMcp(
  registry: ChatRegistry,
  opts: {
    name: string;
    url: string;
    readOnly?: boolean;
    auth?: unknown;
  }
): Promise<string> {
  if (!opts.name.trim() || !opts.url.trim()) {
    throw new Error("name and url are required.");
  }
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await attachCustomMcpFromServer(bridge.harness.registry, {
    name: opts.name,
    url: opts.url,
    readOnly: opts.readOnly,
    auth: parseAuthBody(opts.auth),
  });
  if (!result.ok) throw new Error(result.error ?? "MCP attach failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? `Attached MCP ${opts.name}.`;
}

export async function detachIntegrationMcp(registry: ChatRegistry, name: string): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await detachCustomMcpFromServer(bridge.harness.registry, name);
  if (!result.ok) throw new Error(result.error ?? "MCP detach failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? `Detached MCP ${name}.`;
}

export async function connectIntegrationOpenApi(
  registry: ChatRegistry,
  opts: {
    name: string;
    specUrl: string;
    baseUrl?: string;
    auth?: unknown;
    autoApproveReads?: boolean;
  }
): Promise<string> {
  if (!opts.name.trim() || !opts.specUrl.trim()) {
    throw new Error("name and specUrl are required.");
  }
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await connectOpenApiFromServer(bridge.harness.registry, {
    name: opts.name,
    specUrl: opts.specUrl,
    baseUrl: opts.baseUrl,
    auth: parseAuthBody(opts.auth),
    autoApproveReads: opts.autoApproveReads !== false,
  });
  if (!result.ok) throw new Error(result.error ?? "OpenAPI connect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? `Connected OpenAPI ${opts.name}.`;
}

export async function disconnectIntegrationOpenApi(
  registry: ChatRegistry,
  name: string
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectOpenApiFromServer(bridge.harness.registry, name);
  if (!result.ok) throw new Error(result.error ?? "OpenAPI disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? `Disconnected OpenAPI ${name}.`;
}
