import assert from "node:assert/strict";
import { test } from "node:test";
import { isMcpWriteTool } from "./mcp_tool_classify.js";

test("underscore-form mutation verbs in descriptions retain the approval gate", () => {
  assert.equal(isMcpWriteTool("apply_operations", "Perform batch_update."), true);
  assert.equal(isMcpWriteTool("apply_operations", "Perform set_permissions."), true);
});
