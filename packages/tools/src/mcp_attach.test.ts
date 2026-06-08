import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { ToolRegistry } from "@liminal/core";
import { resolveMcpAutoActivate } from "./mcp_attach.js";

describe("resolveMcpAutoActivate", () => {
  const prevLazy = process.env.AGENT_TOOL_LAZY;
  const prevAuto = process.env.AGENT_INTEGRATION_AUTO_ACTIVATE;

  beforeEach(() => {
    process.env.AGENT_TOOL_LAZY = "1";
    delete process.env.AGENT_INTEGRATION_AUTO_ACTIVATE;
  });

  afterEach(() => {
    if (prevLazy === undefined) delete process.env.AGENT_TOOL_LAZY;
    else process.env.AGENT_TOOL_LAZY = prevLazy;
    if (prevAuto === undefined) delete process.env.AGENT_INTEGRATION_AUTO_ACTIVATE;
    else process.env.AGENT_INTEGRATION_AUTO_ACTIVATE = prevAuto;
  });

  it("does not restore persisted autoActivate:true under lazy loading", () => {
    const registry = new ToolRegistry();
    registry.setLazyToolLoading(true);
    expect(
      resolveMcpAutoActivate(registry, { explicit: true, fromRestore: true })
    ).toBe(false);
  });

  it("honors AGENT_INTEGRATION_AUTO_ACTIVATE on restore", () => {
    process.env.AGENT_INTEGRATION_AUTO_ACTIVATE = "1";
    const registry = new ToolRegistry();
    registry.setLazyToolLoading(true);
    expect(
      resolveMcpAutoActivate(registry, { explicit: true, fromRestore: true })
    ).toBe(true);
  });
});
