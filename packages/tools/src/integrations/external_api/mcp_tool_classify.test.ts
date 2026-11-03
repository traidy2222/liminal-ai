import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isMcpWriteTool, isMcpReadTool, filterMcpToolRecords } from "./mcp_tool_classify.js";

describe("mcp_tool_classify", () => {
  it("keeps read operations containing write-like nouns read-only", () => {
    assert.equal(isMcpWriteTool("get_workflow_run"), false);
    assert.equal(isMcpReadTool("get_workflow_run"), true);
    assert.equal(isMcpWriteTool("mark_read"), true);
  });
  it("gates Gmail trash, spam, reply and forward actions as writes", () => {
    const names = ["trash_message", "trash_thread", "untrash_message", "untrash_thread", "mark_message_spam", "unmark_thread_spam", "reply", "forward"];
    for (const name of names) assert.equal(isMcpWriteTool(name), true, name);
    assert.deepEqual(filterMcpToolRecords(names.map(remoteName => ({ remoteName })), { readOnly: true }), []);
  });
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
