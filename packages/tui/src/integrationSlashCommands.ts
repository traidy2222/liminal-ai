import {
  runSlackHostedConnectFlow,
  runLinearHostedConnectFlow,
  runStripeHostedConnectFlow,
  runXeroHostedConnectFlow,
  runGithubHostedConnectFlow,
  listSlackOAuthAccounts,
  listLinearOAuthAccounts,
  listStripeOAuthAccounts,
  listXeroOAuthAccounts,
  listGithubOAuthAccounts,
  revokeSlackAccount,
  revokeLinearAccount,
  revokeStripeAccount,
  revokeXeroAccount,
  revokeGithubAccount,
} from "@liminal/core";

export type IntegrationSlashResult =
  | { kind: "handled"; message: string }
  | { kind: "usage"; message: string };

const CONNECT_TARGETS = ["slack", "linear", "stripe", "xero", "github"] as const;
type ConnectTarget = (typeof CONNECT_TARGETS)[number];

function isConnectTarget(value: string): value is ConnectTarget {
  return (CONNECT_TARGETS as readonly string[]).includes(value);
}

function parseModeFlag(rest: string[]): "read_write" | "read_only" {
  return rest.includes("--read-only") ? "read_only" : "read_write";
}

export type IntegrationSlashParsed =
  | { action: "status" }
  | { action: "connect" | "disconnect"; provider?: string; mode: "read_write" | "read_only" };

export function parseIntegrationSlashCommand(text: string): IntegrationSlashParsed | null {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (!lower.startsWith("/")) return null;

  const parts = trimmed.split(/\s+/);
  const cmd = parts[0]!.slice(1).toLowerCase();
  if (cmd !== "connect" && cmd !== "disconnect" && cmd !== "integrations") return null;

  if (cmd === "integrations" || (cmd === "connect" && parts.length === 1)) {
    return { action: "status" };
  }

  const provider = parts[1]?.toLowerCase();
  if (!provider) {
    return { action: cmd === "connect" ? "connect" : "disconnect", mode: "read_write" };
  }

  return {
    action: cmd === "connect" ? "connect" : "disconnect",
    provider,
    mode: parseModeFlag(parts.slice(2)),
  };
}

function accountLabel(provider: ConnectTarget, account: Record<string, unknown>): string {
  switch (provider) {
    case "slack":
      return String(account.teamName ?? account.email ?? account.accountId);
    case "linear":
      return String(account.organizationName ?? account.email ?? account.accountId);
    case "stripe":
      return String(account.businessName ?? account.email ?? account.stripeUserId ?? account.accountId);
    case "xero":
      return String(account.email ?? account.accountId);
    case "github":
      return String(account.login ?? account.email ?? account.accountId);
  }
}

async function integrationStatusLine(): Promise<string> {
  const [slack, linear, stripe, xero, github] = await Promise.all([
    listSlackOAuthAccounts(),
    listLinearOAuthAccounts(),
    listStripeOAuthAccounts(),
    listXeroOAuthAccounts(),
    listGithubOAuthAccounts(),
  ]);
  const parts: string[] = [];
  if (slack.length) parts.push(`Slack: ${accountLabel("slack", slack[0]!)}`);
  if (linear.length) parts.push(`Linear: ${accountLabel("linear", linear[0]!)}`);
  if (stripe.length) parts.push(`Stripe: ${accountLabel("stripe", stripe[0]!)}`);
  if (xero.length) parts.push(`Xero: ${accountLabel("xero", xero[0]!)}`);
  if (github.length) parts.push(`GitHub: ${accountLabel("github", github[0]!)}`);
  if (!parts.length) {
    return "No hosted integrations connected. Try /connect slack or liminal connect slack";
  }
  return parts.join(" · ");
}

export async function runIntegrationSlashCommand(
  parsed: IntegrationSlashParsed
): Promise<IntegrationSlashResult> {
  if (parsed.action === "status") {
    return { kind: "handled", message: await integrationStatusLine() };
  }

  const usageConnect = "Usage: /connect <slack|linear|stripe|xero|github> [--read-only]";
  const usageDisconnect = "Usage: /disconnect <slack|linear|stripe|xero|github>";

  if (!parsed.provider || !isConnectTarget(parsed.provider)) {
    return {
      kind: "usage",
      message: parsed.action === "connect" ? usageConnect : usageDisconnect,
    };
  }

  const provider = parsed.provider;

  if (parsed.action === "disconnect") {
    const listers = {
      slack: listSlackOAuthAccounts,
      linear: listLinearOAuthAccounts,
      stripe: listStripeOAuthAccounts,
      xero: listXeroOAuthAccounts,
      github: listGithubOAuthAccounts,
    } as const;
    const revokers = {
      slack: revokeSlackAccount,
      linear: revokeLinearAccount,
      stripe: revokeStripeAccount,
      xero: revokeXeroAccount,
      github: revokeGithubAccount,
    } as const;

    const accounts = await listers[provider]();
    if (!accounts.length) {
      return { kind: "handled", message: `${provider}: not connected` };
    }
    for (const a of accounts) {
      await revokers[provider](a.accountId);
    }
    return { kind: "handled", message: `${provider}: disconnected (${accounts.length} account(s))` };
  }

  const flowOpts = {
    mode: parsed.mode,
    openBrowser: true,
    onStatus: () => {},
  };

  let who: string;
  if (provider === "slack") {
    const result = await runSlackHostedConnectFlow(flowOpts);
    who = result.teamName ?? result.email ?? result.accountId;
  } else if (provider === "linear") {
    const result = await runLinearHostedConnectFlow(flowOpts);
    who = result.organizationName ?? result.email ?? result.accountId;
  } else if (provider === "stripe") {
    const result = await runStripeHostedConnectFlow(flowOpts);
    who = result.email ?? result.stripeUserId ?? result.accountId;
  } else if (provider === "github") {
    const result = await runGithubHostedConnectFlow(flowOpts);
    who = result.login ?? result.email ?? result.accountId;
  } else {
    const result = await runXeroHostedConnectFlow(flowOpts);
    who = result.tenantName
      ? `${result.email ?? result.accountId} · ${result.tenantName}`
      : result.email ?? result.accountId;
  }

  const suffix =
    provider === "github"
      ? " — enable MCP tools in web Settings or connect_provider"
      : " — REST tools ready on next turn";

  return { kind: "handled", message: `${provider}: connected as ${who}${suffix}` };
}
