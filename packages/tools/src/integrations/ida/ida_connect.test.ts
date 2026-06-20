import assert from "node:assert/strict";
import test from "node:test";
import { enrichIdaConnectError, idaGuiMcpUrl, IDA_GUI_MCP_DEFAULT } from "./ida_probe.js";
import { idaSidecarMcpUrl } from "./ida_sidecar.js";
import { idaMcpUrl } from "./ida_connect.js";

test("idaSidecarMcpUrl defaults to local idalib-mcp /mcp endpoint", () => {
  const prevPort = process.env.AGENT_IDA_SIDECAR_PORT;
  const prevUrl = process.env.AGENT_IDA_MCP_URL;
  delete process.env.AGENT_IDA_MCP_URL;
  process.env.AGENT_IDA_SIDECAR_PORT = "8745";
  try {
    assert.equal(idaSidecarMcpUrl(), "http://127.0.0.1:8745/mcp");
    assert.equal(idaMcpUrl(), "http://127.0.0.1:8745/mcp");
  } finally {
    if (prevPort !== undefined) process.env.AGENT_IDA_SIDECAR_PORT = prevPort;
    else delete process.env.AGENT_IDA_SIDECAR_PORT;
    if (prevUrl !== undefined) process.env.AGENT_IDA_MCP_URL = prevUrl;
    else delete process.env.AGENT_IDA_MCP_URL;
  }
});

test("idaSidecarMcpUrl respects AGENT_IDA_MCP_URL override", () => {
  const prev = process.env.AGENT_IDA_MCP_URL;
  process.env.AGENT_IDA_MCP_URL = "http://127.0.0.1:13337/mcp";
  try {
    assert.equal(idaSidecarMcpUrl(8745), "http://127.0.0.1:13337/mcp");
  } finally {
    if (prev !== undefined) process.env.AGENT_IDA_MCP_URL = prev;
    else delete process.env.AGENT_IDA_MCP_URL;
  }
});

test("idaGuiMcpUrl defaults to GUI plugin endpoint", () => {
  const prev = process.env.AGENT_IDA_GUI_MCP_URL;
  delete process.env.AGENT_IDA_GUI_MCP_URL;
  try {
    assert.equal(idaGuiMcpUrl(), IDA_GUI_MCP_DEFAULT);
  } finally {
    if (prev !== undefined) process.env.AGENT_IDA_GUI_MCP_URL = prev;
  }
});

test("enrichIdaConnectError surfaces SP1 upgrade hint", () => {
  const msg = enrichIdaConnectError("idalib worker exited early with code 1: missing get_name");
  assert.match(msg, /SP1/i);
  assert.match(msg, /13337/);
});
