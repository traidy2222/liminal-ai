#!/usr/bin/env node
import { loadEnvForCli } from "./load-env.mjs";
loadEnvForCli();
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveRepoRoot } from "./paths.mjs";

const coreUrl = pathToFileURL(path.join(resolveRepoRoot(), "packages/core/dist/index.js")).href;
const { getGoogleAccessToken } = await import(coreUrl);
const token = await getGoogleAccessToken();
if (!token) {
  console.error("No token");
  process.exit(1);
}

const tests = [
  ["gmail", "https://gmailmcp.googleapis.com/mcp/v1", "list_labels", [{}]],
  ["drive", "https://drivemcp.googleapis.com/mcp/v1", "list_recent_files", [{}, { pageSize: 25 }]],
  [
    "calendar",
    "https://calendarmcp.googleapis.com/mcp/v1",
    "list_calendars",
    [{}, { calendarId: "primary" }],
  ],
];

async function callTool(mcpUrl, tool, args, withInit) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${token}`,
  };
  if (withInit) {
  await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "probe", version: "0.1" },
      },
    }),
  });
  await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  }
  const res = await fetch(mcpUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: tool, arguments: args },
    }),
  });
  const text = await res.text();
  const bad = !res.ok || /"isError":\s*true/.test(text);
  return { status: res.status, bad, text };
}

for (const [name, mcpUrl, tool, argSets] of tests) {
  for (const args of argSets) {
    const withInit = await callTool(mcpUrl, tool, args, true);
    console.log(`${name} ${tool} ${JSON.stringify(args)} init -> HTTP ${withInit.status} ${withInit.bad ? withInit.text.slice(0, 120) : "OK"}`);
    const noInit = await callTool(mcpUrl, tool, args, false);
    console.log(`${name} ${tool} ${JSON.stringify(args)} NO init -> HTTP ${noInit.status} ${noInit.bad ? noInit.text.slice(0, 120) : "OK"}`);
  }
}
