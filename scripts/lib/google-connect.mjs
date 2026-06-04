#!/usr/bin/env node
/**
 * liminal connect google — OAuth + optional MCP attach
 */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvForCli } from "./load-env.mjs";
import { attachGoogleWorkspaceMcp } from "./google-attach.mjs";

function parseArgs(argv) {
  let services;
  let readOnly = false;
  let attach = false;
  let port;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--read-only") readOnly = true;
    else if (a === "--attach") attach = true;
    else if (a === "--port" && argv[i + 1]) {
      port = Number(argv[++i]);
    } else if (a === "--services" && argv[i + 1]) {
      services = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return { services, readOnly, attach, port };
}

/** @param {string[]} argv @returns {Promise<number>} exit code */
export async function runConnectGoogleCli(argv) {
  const { services, readOnly, attach, port } = parseArgs(argv);
  const coreUrl = new URL("../../packages/core/dist/google_connect.js", import.meta.url).href;
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
  const { runGoogleConnectFlow } = mod;
  const result = await runGoogleConnectFlow({
    services,
    mode: readOnly ? "read_only" : "read_write",
    port,
    onStatus: (m) => console.log(m),
  });
  console.log(`\nGoogle connected as ${result.email ?? result.accountId}`);
  console.log(`Scopes granted: ${result.scopes.length}`);

  if (attach) {
    console.log("\nAttaching Google Workspace MCP tools…");
    return attachGoogleWorkspaceMcp({ services, mode: readOnly ? "read_only" : "read_write" });
  }

  console.log(
    "\nNext: run `liminal connect google --attach` or in web Settings → Integrations click **Attach MCP tools**."
  );
  return 0;
}

const isDirectRun =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isDirectRun) {
  loadEnvForCli();
  runConnectGoogleCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
