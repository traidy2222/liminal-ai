#!/usr/bin/env node
/** liminal disconnect google — revoke OAuth and remove MCP connections (via agent tools on next web session). */
import { loadEnvForCli } from "./load-env.mjs";

loadEnvForCli();

async function main() {
  const coreUrl = new URL("../../packages/core/dist/oauth_broker.js", import.meta.url).href;
  const { listGoogleOAuthAccounts, revokeGoogleAccount } = await import(coreUrl);
  const accounts = await listGoogleOAuthAccounts();
  if (accounts.length === 0) {
    console.log("No Google OAuth accounts on disk.");
    return;
  }
  for (const a of accounts) {
    await revokeGoogleAccount(a.accountId);
    console.log(`Revoked ${a.email ?? a.accountId}`);
  }
  console.log("Remove MCP connection files under ~/.liminal/api_connections/google_*.json if present.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
