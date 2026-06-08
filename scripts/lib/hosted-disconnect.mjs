#!/usr/bin/env node
/** liminal disconnect <slack|linear|xero|github> — revoke OAuth tokens on disk */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvForCli } from "./load-env.mjs";

/** @type {Record<string, { list: string; revoke: string; label: string }>} */
const HOSTED_PROVIDERS = {
  slack: {
    list: "listSlackOAuthAccounts",
    revoke: "revokeSlackAccount",
    label: "Slack",
  },
  linear: {
    list: "listLinearOAuthAccounts",
    revoke: "revokeLinearAccount",
    label: "Linear",
  },
  notion: {
    list: "listNotionOAuthAccounts",
    revoke: "revokeNotionAccount",
    label: "Notion",
  },
  xero: {
    list: "listXeroOAuthAccounts",
    revoke: "revokeXeroAccount",
    label: "Xero",
  },
  github: {
    list: "listGithubOAuthAccounts",
    revoke: "revokeGithubAccount",
    label: "GitHub",
  },
};

export const HOSTED_DISCONNECT_TARGETS = Object.keys(HOSTED_PROVIDERS);

/** @param {string} provider @returns {Promise<number>} */
export async function runHostedDisconnectCli(provider) {
  const spec = HOSTED_PROVIDERS[provider];
  if (!spec) {
    console.error(
      `Unknown provider: ${provider}. Try: ${HOSTED_DISCONNECT_TARGETS.map((p) => `liminal disconnect ${p}`).join(", ")}`
    );
    return 1;
  }

  const moduleFiles = {
    slack: "slack_oauth_broker.js",
    linear: "linear_oauth_broker.js",
    notion: "notion_oauth_broker.js",
    xero: "xero_oauth_broker.js",
    github: "github_oauth_broker.js",
  };
  const moduleUrl = new URL(`../../packages/core/dist/${moduleFiles[provider]}`, import.meta.url).href;

  let mod;
  try {
    mod = await import(moduleUrl);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      console.error("Build core first: npm run build -w packages/core");
      return 1;
    }
    throw err;
  }

  const listAccounts = mod[spec.list];
  const revokeAccount = mod[spec.revoke];
  if (typeof listAccounts !== "function" || typeof revokeAccount !== "function") {
    console.error(`Missing broker helpers for ${provider}`);
    return 1;
  }

  const accounts = await listAccounts();
  if (accounts.length === 0) {
    console.log(`No ${spec.label} OAuth accounts on disk.`);
    return 0;
  }

  for (const a of accounts) {
    await revokeAccount(a.accountId);
    const label =
      a.teamName ??
      a.organizationName ??
      a.workspaceName ??
      a.login ??
      a.email ??
      a.tenantName ??
      a.accountId;
    console.log(`Revoked ${label}`);
  }
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  loadEnvForCli();
  const provider = process.argv[2];
  if (!provider) {
    console.error(`Usage: liminal disconnect <${HOSTED_DISCONNECT_TARGETS.join("|")}>`);
    process.exit(1);
  }
  runHostedDisconnectCli(provider)
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
