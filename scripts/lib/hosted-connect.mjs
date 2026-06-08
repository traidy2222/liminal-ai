#!/usr/bin/env node
/**
 * liminal connect <slack|linear|stripe|xero|github> — hosted OAuth via vireondynamics.com
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvForCli } from "./load-env.mjs";

/** @type {Record<string, { module: string; export: string; label: string }>} */
const HOSTED_PROVIDERS = {
  slack: { module: "slack_connect.js", export: "runSlackHostedConnectFlow", label: "Slack" },
  linear: { module: "linear_connect.js", export: "runLinearHostedConnectFlow", label: "Linear" },
  stripe: { module: "stripe_connect.js", export: "runStripeHostedConnectFlow", label: "Stripe" },
  xero: { module: "xero_connect.js", export: "runXeroHostedConnectFlow", label: "Xero" },
  github: { module: "github_hosted_connect.js", export: "runGithubHostedConnectFlow", label: "GitHub" },
};

export const HOSTED_CONNECT_TARGETS = Object.keys(HOSTED_PROVIDERS);

function parseArgs(argv) {
  let readOnly = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--read-only") readOnly = true;
  }
  return { readOnly };
}

function formatResult(provider, result) {
  switch (provider) {
    case "slack":
      return result.teamName ?? result.email ?? result.accountId;
    case "linear":
      return result.organizationName ?? result.email ?? result.accountId;
    case "stripe":
      return result.email ?? result.stripeUserId ?? result.accountId;
    case "xero":
      return result.tenantName
        ? `${result.email ?? result.accountId} · ${result.tenantName}`
        : result.email ?? result.accountId;
    case "github":
      return result.login ?? result.email ?? result.accountId;
    default:
      return result.email ?? result.accountId;
  }
}

/** @param {string} provider @param {string[]} argv @returns {Promise<number>} */
export async function runHostedConnectCli(provider, argv) {
  const spec = HOSTED_PROVIDERS[provider];
  if (!spec) {
    console.error(
      `Unknown provider: ${provider}. Try: ${HOSTED_CONNECT_TARGETS.map((p) => `liminal connect ${p}`).join(", ")}`
    );
    return 1;
  }

  const { readOnly } = parseArgs(argv);
  const coreUrl = new URL(`../../packages/core/dist/${spec.module}`, import.meta.url).href;
  let mod;
  try {
    mod = await import(coreUrl);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      console.error("Build core first: npm run build -w packages/core");
      return 1;
    }
    throw err;
  }

  const runFlow = mod[spec.export];
  if (typeof runFlow !== "function") {
    console.error(`Missing ${spec.export} in ${spec.module}`);
    return 1;
  }

  console.log(`Opening browser for ${spec.label} sign-in…`);
  const result = await runFlow({
    mode: readOnly ? "read_only" : "read_write",
    openBrowser: true,
    onStatus: (m) => console.log(m),
  });

  const who = formatResult(provider, result);
  console.log(`\n${spec.label} connected as ${who}`);
  console.log(`Scopes granted: ${result.scopes?.length ?? 0}`);

  if (provider === "github") {
    console.log(
      "\nNext: in web Settings → Integrations click **Enable tools**, or ask the agent to connect_provider({ provider: \"github\" })."
    );
  } else if (provider === "google") {
    // not used here
  } else {
    console.log(`\n${spec.label} REST tools are available on the next agent turn (or restart harness).`);
  }
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  loadEnvForCli();
  const provider = process.argv[2];
  if (!provider || provider === "-h" || provider === "--help") {
    console.log(
      `Usage: liminal connect <${HOSTED_CONNECT_TARGETS.join("|")}> [--read-only]\n` +
        "Opens browser for hosted OAuth on vireondynamics.com."
    );
    process.exit(provider ? 0 : 1);
  }
  runHostedConnectCli(provider, process.argv.slice(3))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
