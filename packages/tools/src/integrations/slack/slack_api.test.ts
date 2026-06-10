import assert from "node:assert/strict";
import { test } from "node:test";
import { slackEncodeFields } from "./slack_api.js";

test("slackEncodeFields stringifies objects and booleans for form POST", () => {
  assert.deepEqual(
    slackEncodeFields({
      channel: "C1",
      limit: 20,
      exclude_archived: true,
      files: [{ id: "F1", title: "a.txt" }],
    }),
    {
      channel: "C1",
      limit: "20",
      exclude_archived: "true",
      files: '[{"id":"F1","title":"a.txt"}]',
    }
  );
});
