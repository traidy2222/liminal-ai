#!/usr/bin/env node
/** liminal disconnect google — revoke OAuth and remove MCP connections (via agent tools on next web session). */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const coreDist = path.join(__dirname, "../../packages/core/dist/oauth_broker.js").replace(/\\/g, "/");
  const { listGoogleOAuthAccounts, revokeGoogleAccount } = await import(coreDist);
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
