#!/usr/bin/env node
/** Probe Google official MCP APIs (gmailmcp, drivemcp, …) vs classic REST. */
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadEnvForCli } from "./load-env.mjs";
import { resolveRepoRoot } from "./paths.mjs";

loadEnvForCli();

const repoRoot = resolveRepoRoot();
const coreUrl = pathToFileURL(path.join(repoRoot, "packages/core/dist/index.js")).href;

const {
  getGoogleAccessToken,
  googleProjectIdFromClientId,
  googleCloudMcpApiLibraryUrl,
  listGoogleOAuthAccounts,
} = await import(coreUrl);

const token = await getGoogleAccessToken();
if (!token) {
  console.error("No Google OAuth token — run: liminal connect google --attach");
  process.exit(1);
}

const accounts = await listGoogleOAuthAccounts();
const acct = accounts[0];
if (acct?.scopes) {
  const needCompose = "https://www.googleapis.com/auth/gmail.compose";
  const hasCompose = acct.scopes.includes(needCompose);
  if (!hasCompose) {
    console.warn(
      "Token missing gmail.compose (required for Gmail MCP). Revoke at https://myaccount.google.com/permissions then:\n  liminal connect google --attach\n"
    );
  }
}

const projectId = googleProjectIdFromClientId();
console.log(`Project: ${projectId ?? "(unknown)"}\n`);

const classicGmail = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`Gmail API (classic):     ${classicGmail.status} ${classicGmail.statusText}`);

const mcpUrl = "https://gmailmcp.googleapis.com/mcp/v1";
const mcpHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  Authorization: `Bearer ${token}`,
};
await fetch(mcpUrl, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "liminal-probe", version: "0.1.0" },
    },
  }),
});
await fetch(mcpUrl, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
});
const mcpRes = await fetch(mcpUrl, {
  method: "POST",
  headers: mcpHeaders,
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/call",
    params: { name: "list_labels", arguments: {} },
  }),
});
console.log(`Gmail MCP API:           ${mcpRes.status} ${mcpRes.statusText}`);
const mcpText = await mcpRes.text();
let mcpOk = mcpRes.ok;
try {
  const j = JSON.parse(mcpText);
  if (j.result?.isError) {
    mcpOk = false;
    const msg = j.result.content?.[0]?.text ?? "";
    console.log(`  → ${msg.slice(0, 200)}`);
    if (/disabled|MCP API has not been used/i.test(msg)) {
      const enable = googleCloudMcpApiLibraryUrl("gmail", projectId);
      if (enable) console.log(`\nEnable: ${enable}`);
    }
    if (/does not have permission/i.test(msg)) {
      console.log(
        "\nOAuth scopes look correct but MCP still rejects — enroll Cloud project 102482009638 in the\n" +
          "Google Workspace Developer Preview Program: https://developers.google.com/workspace/preview\n" +
          "(Gmail MCP is preview-only; classic gmail.googleapis.com can work without it.)"
      );
    }
  } else if (j.result?.content) {
    console.log("  → MCP list_labels OK");
  }
} catch {
  console.log(mcpText.slice(0, 300));
}

process.exit(mcpOk && classicGmail.ok ? 0 : 1);
