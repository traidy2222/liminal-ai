import {
  runSlackHostedConnectFlow,
  runLinearHostedConnectFlow,
  runNotionHostedConnectFlow,
  runYoutubeHostedConnectFlow,
  runGoogleHostedConnectFlow,
  runGithubHostedConnectFlow,
  runMicrosoftHostedConnectFlow,
  runAzureHostedConnectFlow,
  runXeroHostedConnectFlow,
} from "@liminal/core";
import {
  attachCustomMcpFromServer,
  connectGithubFromServer,
  connectGoogleWorkspaceFromServer,
  connectMicrosoft365FromServer,
  connectAzureFromServer,
  connectXeroFromServer,
  connectSlackFromServer,
  connectLinearFromServer,
  connectNotionFromServer,
  connectYoutubeFromServer,
  connectOpenApiFromServer,
  detachCustomMcpFromServer,
  disconnectGithubFromServer,
  disconnectGoogleWorkspaceFromServer,
  disconnectMicrosoft365FromServer,
  disconnectAzureFromServer,
  disconnectXeroFromServer,
  disconnectSlackFromServer,
  disconnectLinearFromServer,
  disconnectNotionFromServer,
  disconnectYoutubeFromServer,
  disconnectOpenApiFromServer,
  buildIntegrationsSnapshot,
  listIntegrationConnections,
  parseAuthBody,
  refreshIntegrationToolsOnRegistry,
  revokeIntegrationAccountFromServer,
  type IntegrationAccountSlug,
} from "@liminal/tools";
import type { ChatRegistry } from "./chat_registry.js";

export { buildIntegrationsSnapshot };

function assertHarnessesIdle(registry: ChatRegistry): void {
  if (registry.anyHarnessBusy()) {
    throw new Error("Agent is busy; finish the current turn before changing integrations.");
  }
}

async function allHarnessRegistries(registry: ChatRegistry) {
  const registries = registry.listBridges().map((b) => b.harness.registry);
  if (registries.length > 0) return registries;
  const bridge = await registry.getOrCreateActive();
  return [bridge.harness.registry];
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
  const result = await runGoogleHostedConnectFlow({
    services: opts.services,
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[google-oauth] ${m}`),
  });
  let attachOutput: string | undefined;
  if (opts.attach !== false) {
    attachOutput = await connectGoogleWorkspace(registry, {
      services: opts.services,
      mode: opts.mode ?? "read_write",
    });
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

export async function connectGithubOAuth(
  registry: ChatRegistry,
  opts: {
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  }
): Promise<{ email?: string; accountId: string; login?: string; attachOutput?: string }> {
  const result = await runGithubHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[github-oauth] ${m}`),
  });
  let attachOutput: string | undefined;
  if (opts.attach !== false) {
    attachOutput = await connectGithub(registry, {
      readOnly: opts.mode === "read_only",
    });
  }
  return {
    email: result.email,
    accountId: result.accountId,
    login: result.login,
    attachOutput,
  };
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

export async function disconnectGithub(registry: ChatRegistry, revoke = false): Promise<string> {
  assertHarnessesIdle(registry);
  const result = await disconnectGithubFromServer(await allHarnessRegistries(registry), revoke);
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
  const result = await runMicrosoftHostedConnectFlow({
    services: opts.services,
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[microsoft-oauth] ${m}`),
  });
  let attachOutput: string | undefined;
  if (opts.attach !== false) {
    attachOutput = await connectMicrosoft365(registry, {
      services: opts.services,
      mode: opts.mode ?? "read_write",
    });
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
  const result = await disconnectMicrosoft365FromServer(await allHarnessRegistries(registry), revoke);
  if (!result.ok) throw new Error(result.error ?? "Microsoft disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Microsoft disconnected.";
}

export async function connectAzureOAuth(
  registry: ChatRegistry,
  opts: {
    services?: string[];
    mode?: "read_write" | "read_only";
    openBrowser?: boolean;
    attach?: boolean;
  }
): Promise<{ email?: string; accountId: string; attachOutput?: string }> {
  const result = await runAzureHostedConnectFlow({
    services: opts.services,
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[azure-oauth] ${m}`),
  });
  let attachOutput: string | undefined;
  if (opts.attach !== false) {
    attachOutput = await connectAzure(registry, {
      services: opts.services,
      mode: opts.mode ?? "read_write",
    });
  }
  return { email: result.email, accountId: result.accountId, attachOutput };
}

export async function connectAzure(
  registry: ChatRegistry,
  opts: { services?: string[]; mode?: "read_write" | "read_only" }
): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await connectAzureFromServer(bridge.harness.registry, opts);
  if (!result.ok) throw new Error(result.error ?? "Azure connect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Azure tools attached.";
}

export async function disconnectAzure(registry: ChatRegistry, revoke: boolean): Promise<string> {
  assertHarnessesIdle(registry);
  const result = await disconnectAzureFromServer(await allHarnessRegistries(registry), revoke);
  if (!result.ok) throw new Error(result.error ?? "Azure disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Azure disconnected.";
}

export async function disconnectGoogle(
  registry: ChatRegistry,
  revoke: boolean
): Promise<string> {
  assertHarnessesIdle(registry);
  const result = await disconnectGoogleWorkspaceFromServer(await allHarnessRegistries(registry), revoke);
  if (!result.ok) throw new Error(result.error ?? "Google disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Google disconnected.";
}

export async function revokeIntegrationAccount(
  registry: ChatRegistry,
  provider: IntegrationAccountSlug,
  accountId: string
): Promise<string> {
  assertHarnessesIdle(registry);
  const result = await revokeIntegrationAccountFromServer(
    await allHarnessRegistries(registry),
    provider,
    accountId
  );
  if (!result.ok) throw new Error(result.error ?? "Failed to remove account.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Account removed.";
}

export async function connectXeroOAuth(
  registry: ChatRegistry,
  opts: {
    mode?: "read_write" | "read_only";
    extended?: boolean;
    fullScopes?: boolean;
    journals?: boolean;
    openBrowser?: boolean;
  }
): Promise<{ email?: string; accountId: string; tenantName?: string }> {
  const result = await runXeroHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    extended: opts.extended === true,
    fullScopes: opts.fullScopes === true,
    journals: opts.journals === true,
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

export async function connectSlackOAuth(
  registry: ChatRegistry,
  opts: { mode?: "read_write" | "read_only"; openBrowser?: boolean }
): Promise<{ accountId: string; email?: string; teamName?: string }> {
  const result = await runSlackHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[slack-oauth] ${m}`),
  });
  try {
    assertHarnessesIdle(registry);
    const bridge = await registry.getOrCreateActive();
    await connectSlackFromServer(bridge.harness.registry);
    await refreshIntegrationsOnAllHarnesses(registry);
  } catch (e) {
    console.warn("[slack-oauth] tokens saved but harness refresh failed:", e instanceof Error ? e.message : e);
  }
  return result;
}

export async function disconnectSlack(registry: ChatRegistry, revoke: boolean): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectSlackFromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "Slack disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Slack disconnected.";
}

export async function connectLinearOAuth(
  registry: ChatRegistry,
  opts: { mode?: "read_write" | "read_only"; openBrowser?: boolean }
): Promise<{ accountId: string; email?: string; organizationName?: string }> {
  const result = await runLinearHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[linear-oauth] ${m}`),
  });
  try {
    assertHarnessesIdle(registry);
    const bridge = await registry.getOrCreateActive();
    await connectLinearFromServer(bridge.harness.registry);
    await refreshIntegrationsOnAllHarnesses(registry);
  } catch (e) {
    console.warn("[linear-oauth] tokens saved but harness refresh failed:", e instanceof Error ? e.message : e);
  }
  return result;
}

export async function disconnectLinear(registry: ChatRegistry, revoke: boolean): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectLinearFromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "Linear disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Linear disconnected.";
}

export async function connectNotionOAuth(
  registry: ChatRegistry,
  opts: { mode?: "read_write" | "read_only"; openBrowser?: boolean }
): Promise<{ accountId: string; email?: string; workspaceName?: string }> {
  const result = await runNotionHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[notion-oauth] ${m}`),
  });
  try {
    assertHarnessesIdle(registry);
    const bridge = await registry.getOrCreateActive();
    await connectNotionFromServer(bridge.harness.registry);
    await refreshIntegrationsOnAllHarnesses(registry);
  } catch (e) {
    console.warn("[notion-oauth] tokens saved but harness refresh failed:", e instanceof Error ? e.message : e);
  }
  return result;
}

export async function disconnectNotion(registry: ChatRegistry, revoke: boolean): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectNotionFromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "Notion disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "Notion disconnected.";
}

export async function connectYoutubeOAuth(
  registry: ChatRegistry,
  opts: { mode?: "read_write" | "read_only"; openBrowser?: boolean }
): Promise<{ accountId: string; email?: string; metadata?: Record<string, unknown> }> {
  const result = await runYoutubeHostedConnectFlow({
    mode: opts.mode ?? "read_write",
    openBrowser: opts.openBrowser !== false,
    onStatus: (m) => console.log(`[youtube-oauth] ${m}`),
  });
  try {
    assertHarnessesIdle(registry);
    const bridge = await registry.getOrCreateActive();
    await connectYoutubeFromServer(bridge.harness.registry);
    await refreshIntegrationsOnAllHarnesses(registry);
  } catch (e) {
    console.warn("[youtube-oauth] tokens saved but harness refresh failed:", e instanceof Error ? e.message : e);
  }
  return result;
}

export async function disconnectYoutube(registry: ChatRegistry, revoke: boolean): Promise<string> {
  assertHarnessesIdle(registry);
  const bridge = await registry.getOrCreateActive();
  const result = await disconnectYoutubeFromServer(bridge.harness.registry, revoke);
  if (!result.ok) throw new Error(result.error ?? "YouTube disconnect failed.");
  await refreshIntegrationsOnAllHarnesses(registry);
  return result.output ?? "YouTube disconnected.";
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
