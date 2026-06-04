#!/usr/bin/env node
/**
 * liminal connect google — OAuth + optional MCP attach
 */
import { loadEnvForCli } from "./load-env.mjs";

loadEnvForCli();

function parseArgs(argv) {
  let services;
  let readOnly = false;
  let attach = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--read-only") readOnly = true;
    else if (a === "--attach") attach = true;
    else if (a === "--services" && argv[i + 1]) {
      services = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return { services, readOnly, attach };
}

async function main() {
  const { services, readOnly, attach } = parseArgs(process.argv.slice(2));
  const coreUrl = new URL("../../packages/core/dist/google_connect.js", import.meta.url).href;
  let mod;
  try {
    mod = await import(coreUrl);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      console.error("Build core first: npm run build -w packages/core");
      process.exit(1);
    }
    throw err;
  }
  const { runGoogleConnectFlow } = mod;
  const result = await runGoogleConnectFlow({
    services,
    mode: readOnly ? "read_only" : "read_write",
    onStatus: (m) => console.log(m),
  });
  console.log(`\nGoogle connected as ${result.email ?? result.accountId}`);
  console.log(`Scopes: ${result.scopes.length}`);

  if (attach) {
    console.log("\nTo attach MCP tools, ask the agent to run connect_provider or use web Settings → Integrations → Attach MCP tools.");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
