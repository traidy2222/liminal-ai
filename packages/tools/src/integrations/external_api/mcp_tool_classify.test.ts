import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMcpWriteTool, isMcpReadTool, filterMcpToolRecords } from "./mcp_tool_classify.js";

describe("mcp_tool_classify", () => {
  it("classifies read tools", () => {
    assert.equal(isMcpReadTool("search_files"), true);
    assert.equal(isMcpReadTool("read_sheet_values"), true);
    assert.equal(isMcpWriteTool("search_files"), false);
  });

  it("classifies write tools", () => {
    assert.equal(isMcpWriteTool("create_event"), true);
    assert.equal(isMcpWriteTool("modify_sheet_values"), true);
    assert.equal(isMcpReadTool("modify_sheet_values"), false);
  });

  it("filters write tools in read_only mode", () => {
    const tools = [
      { remoteName: "read_sheet_values" },
      { remoteName: "modify_sheet_values" },
    ];
    const out = filterMcpToolRecords(tools, { readOnly: true });
    assert.equal(out.length, 1);
    assert.equal(out[0]!.remoteName, "read_sheet_values");
  });
});
