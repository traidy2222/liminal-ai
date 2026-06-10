import assert from "node:assert/strict";
import { test } from "node:test";
import { githubMcpUrl, githubTokenEnvVar } from "./github_connect.js";

test("githubMcpUrl defaults to GitHub Copilot MCP endpoint", () => {
  const prev = process.env.GITHUB_MCP_URL;
  delete process.env.GITHUB_MCP_URL;
  try {
    assert.equal(githubMcpUrl(), "https://api.githubcopilot.com/mcp/");
    assert.equal(githubMcpUrl(true), "https://api.githubcopilot.com/mcp/readonly");
  } finally {
    if (prev !== undefined) process.env.GITHUB_MCP_URL = prev;
    else delete process.env.GITHUB_MCP_URL;
  }
});

test("githubTokenEnvVar defaults to GITHUB_TOKEN", () => {
  assert.equal(githubTokenEnvVar(), "GITHUB_TOKEN");
});
