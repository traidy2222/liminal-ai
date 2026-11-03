import assert from "node:assert/strict";
import { test } from "node:test";
import { isMcpWriteTool, filterMcpToolRecords } from "./mcp_tool_classify.js";

test("read resource nouns remain reads while compound mutations require approval", () => {
  for (const name of ["get_label", "get_workflow_run", "get_project_update"]) assert.equal(isMcpWriteTool(name), false, name);
  for (const name of ["get_or_create_label", "get_and_delete_message", "read_then_mark_read"]) assert.equal(isMcpWriteTool(name), true, name);
  assert.deepEqual(filterMcpToolRecords([{ remoteName: "get_label" }, { remoteName: "get_or_create_label" }], { readOnly: true }), [{ remoteName: "get_label" }]);
});
