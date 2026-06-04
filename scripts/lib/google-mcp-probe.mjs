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
} = await import(coreUrl);

const token = await getGoogleAccessToken();
if (!token) {
  console.error("No Google OAuth token — run: liminal connect google --attach");
  process.exit(1);
}

const projectId = googleProjectIdFromClientId();
console.log(`Project: ${projectId ?? "(unknown)"}\n`);

const classicGmail = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", {
  headers: { Authorization: `Bearer ${token}` },
});
console.log(`Gmail API (classic):     ${classicGmail.status} ${classicGmail.statusText}`);

const mcpUrl = "https://gmailmcp.googleapis.com/mcp/v1";
const callBody = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: { name: "list_labels", arguments: {} },
};
const mcpRes = await fetch(mcpUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify(callBody),
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
  } else if (j.result?.content) {
    console.log("  → MCP list_labels OK");
  }
} catch {
  console.log(mcpText.slice(0, 300));
}

process.exit(mcpOk && classicGmail.ok ? 0 : 1);
