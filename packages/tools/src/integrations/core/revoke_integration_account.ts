/**
 * Remove one linked OAuth account without revoking every account for the provider.
 */
import type { ToolRegistry } from "@liminal/core";
import {
  listAzureOAuthAccounts,
  listGithubOAuthAccounts,
  listGoogleOAuthAccounts,
  listLinearOAuthAccounts,
  listMicrosoftOAuthAccounts,
  listNotionOAuthAccounts,
  listYoutubeOAuthAccounts,
  listSlackOAuthAccounts,
  listXeroOAuthAccounts,
  revokeAzureAccount,
  revokeGithubAccount,
  revokeGoogleAccount,
  revokeLinearAccount,
  revokeMicrosoftAccount,
  revokeNotionAccount,
  revokeYoutubeAccount,
  revokeSlackAccount,
  revokeXeroAccount,
  sanitizeOAuthAccountId,
} from "@liminal/core";
import {
  deleteConnection,
  listAzureConnections,
  listConnectionsByParent,
  listGoogleWorkspaceConnections,
  listMicrosoft365Connections,
  type McpConnectionRecord,
} from "../external_api/api_connections_store.js";
import { unregisterMcpConnection } from "../external_api/mcp_attach.js";
import { releaseAzureSidecar } from "../azure/azure_sidecar.js";
import { releaseGoogleSidecar } from "../google/google_sidecar.js";
import { releaseMicrosoftSidecar } from "../microsoft/microsoft_sidecar.js";
import { GITHUB_PARENT_PROVIDER } from "../github/github_connect.js";

export type IntegrationAccountSlug =
  | "google"
  | "microsoft"
  | "azure"
  | "github"
  | "xero"
  | "slack"
  | "linear"
  | "notion"
  | "youtube";

const VALID_SLUGS = new Set<IntegrationAccountSlug>([
  "google",
  "microsoft",
  "azure",
  "github",
  "xero",
  "slack",
  "linear",
  "notion",
  "youtube",
]);

function normalizeRegistries(registry: ToolRegistry | ToolRegistry[]): ToolRegistry[] {
  return Array.isArray(registry) ? registry : [registry];
}

async function detachMcpForAccount(
  registry: ToolRegistry | ToolRegistry[],
  listConns: () => Promise<McpConnectionRecord[]>,
  accountId: string,
  releaseSidecar?: () => Promise<void>
): Promise<{ toolCount: number; connCount: number }> {
  const registries = normalizeRegistries(registry);
  const conns = await listConns();
  let toolCount = 0;
  let connCount = 0;
  let hadSidecar = false;
  for (const c of conns) {
    if (c.oauthAccountId && c.oauthAccountId !== accountId) continue;
    if (!c.oauthAccountId && connCount > 0) continue;
    if (c.sidecarManaged) hadSidecar = true;
    for (const reg of registries) {
      toolCount += unregisterMcpConnection(reg, c);
    }
    await deleteConnection(c.name);
    connCount++;
  }
  if (hadSidecar && releaseSidecar) await releaseSidecar();
  return { toolCount, connCount };
}

function accountLabel(
  slug: IntegrationAccountSlug,
  accountId: string,
  meta?: { email?: string; login?: string; tenantName?: string; teamName?: string; organizationName?: string; workspaceName?: string; channelTitle?: string }
): string {
  if (slug === "github" && meta?.login) return meta.login;
  if (slug === "xero" && meta?.tenantName) return meta.tenantName;
  if (slug === "slack" && meta?.teamName) return meta.teamName;
  if (slug === "linear" && meta?.organizationName) return meta.organizationName;
  if (slug === "notion" && meta?.workspaceName) return meta.workspaceName;
  if (slug === "youtube" && meta?.channelTitle) return meta.channelTitle;
  return meta?.email ?? accountId;
}

export async function revokeIntegrationAccountFromServer(
  registry: ToolRegistry | ToolRegistry[],
  slug: IntegrationAccountSlug,
  rawAccountId: string
): Promise<{ ok: boolean; output?: string; error?: string }> {
  if (!VALID_SLUGS.has(slug)) {
    return { ok: false, error: `unknown provider slug: ${slug}` };
  }
  const accountId = sanitizeOAuthAccountId(rawAccountId);
  if (!accountId) return { ok: false, error: "invalid accountId" };

  switch (slug) {
    case "google": {
      const accounts = await listGoogleOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Google account not found" };
      const { toolCount, connCount } = await detachMcpForAccount(
        registry,
        listGoogleWorkspaceConnections,
        accountId,
        () => releaseGoogleSidecar()
      );
      await revokeGoogleAccount(accountId);
      const label = accountLabel(slug, accountId, { email: match.email });
      const remaining = (await listGoogleOAuthAccounts()).length;
      let output = `Removed Google account ${label}.`;
      if (connCount > 0) {
        output +=
          ` Detached ${toolCount} MCP tools from ${connCount} connection(s)` +
          (remaining > 0 ? " — use Enable tools to attach another account." : ".");
      }
      return { ok: true, output };
    }
    case "microsoft": {
      const accounts = await listMicrosoftOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Microsoft account not found" };
      const { toolCount, connCount } = await detachMcpForAccount(
        registry,
        listMicrosoft365Connections,
        accountId,
        () => releaseMicrosoftSidecar()
      );
      await revokeMicrosoftAccount(accountId);
      const label = accountLabel(slug, accountId, { email: match.email });
      const remaining = (await listMicrosoftOAuthAccounts()).length;
      let output = `Removed Microsoft account ${label}.`;
      if (connCount > 0) {
        output +=
          ` Detached ${toolCount} MCP tools` +
          (remaining > 0 ? " — use Enable tools to attach another account." : ".");
      }
      return { ok: true, output };
    }
    case "azure": {
      const accounts = await listAzureOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Azure account not found" };
      const { toolCount, connCount } = await detachMcpForAccount(
        registry,
        listAzureConnections,
        accountId,
        () => releaseAzureSidecar()
      );
      await revokeAzureAccount(accountId);
      const label = accountLabel(slug, accountId, { email: match.email });
      const remaining = (await listAzureOAuthAccounts()).length;
      let output = `Removed Azure account ${label}.`;
      if (connCount > 0) {
        output +=
          ` Detached ${toolCount} MCP tools` +
          (remaining > 0 ? " — use Enable tools to attach another account." : ".");
      }
      return { ok: true, output };
    }
    case "github": {
      const accounts = await listGithubOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "GitHub account not found" };
      const { toolCount, connCount } = await detachMcpForAccount(
        registry,
        () => listConnectionsByParent(GITHUB_PARENT_PROVIDER),
        accountId
      );
      await revokeGithubAccount(accountId);
      const label = accountLabel(slug, accountId, { email: match.email, login: match.login });
      const remaining = (await listGithubOAuthAccounts()).length;
      let output = `Removed GitHub account ${label}.`;
      if (connCount > 0) {
        output +=
          ` Detached ${toolCount} MCP tools` +
          (remaining > 0 ? " — use Enable tools to attach another account." : ".");
      }
      return { ok: true, output };
    }
    case "xero": {
      const accounts = await listXeroOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Xero account not found" };
      await revokeXeroAccount(accountId);
      const label = accountLabel(slug, accountId, {
        email: match.email,
        tenantName: match.tenantName,
      });
      return { ok: true, output: `Removed Xero account ${label}.` };
    }
    case "slack": {
      const accounts = await listSlackOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Slack account not found" };
      await revokeSlackAccount(accountId);
      const label = accountLabel(slug, accountId, {
        email: match.email,
        teamName: match.teamName,
      });
      return { ok: true, output: `Removed Slack workspace ${label}.` };
    }
    case "linear": {
      const accounts = await listLinearOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Linear account not found" };
      await revokeLinearAccount(accountId);
      const label = accountLabel(slug, accountId, {
        email: match.email,
        organizationName: match.organizationName,
      });
      return { ok: true, output: `Removed Linear account ${label}.` };
    }
    case "notion": {
      const accounts = await listNotionOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "Notion account not found" };
      await revokeNotionAccount(accountId);
      const label = accountLabel(slug, accountId, {
        email: match.email,
        workspaceName: match.workspaceName,
      });
      return { ok: true, output: `Removed Notion workspace ${label}.` };
    }
    case "youtube": {
      const accounts = await listYoutubeOAuthAccounts();
      const match = accounts.find((a) => a.accountId === accountId);
      if (!match) return { ok: false, error: "YouTube account not found" };
      await revokeYoutubeAccount(accountId);
      const label = accountLabel(slug, accountId, {
        email: match.email,
        channelTitle: match.channelTitle,
      });
      return { ok: true, output: `Removed YouTube channel ${label}.` };
    }
  }
}
