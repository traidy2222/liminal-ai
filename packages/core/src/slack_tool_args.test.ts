import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeSlackRestToolArgs } from "./slack_tool_args.js";

test("normalizeSlackRestToolArgs maps search limit to count", () => {
  const out = normalizeSlackRestToolArgs("slack_search_messages", { query: "test", limit: 5 });
  assert.equal(out["count"], 5);
  assert.equal(out["limit"], undefined);
});

test("normalizeSlackRestToolArgs maps history count to limit", () => {
  const out = normalizeSlackRestToolArgs("slack_get_channel_history", {
    channel: "C1",
    count: 10,
  });
  assert.equal(out["limit"], 10);
});

test("normalizeSlackRestToolArgs stringifies numeric thread_ts", () => {
  const out = normalizeSlackRestToolArgs("slack_reply_in_thread", {
    channel: "C1",
    thread_ts: 1772746316.035959,
    text: "hi",
  });
  assert.equal(out["thread_ts"], "1772746316.035959");
});

test("normalizeSlackRestToolArgs maps q to query for search", () => {
  const out = normalizeSlackRestToolArgs("slack_search_messages", { q: "deploy", limit: 3 });
  assert.equal(out["query"], "deploy");
  assert.equal(out["count"], 3);
  assert.equal(out["q"], undefined);
});

test("normalizeSlackRestToolArgs maps parent_ts to thread_ts", () => {
  const out = normalizeSlackRestToolArgs("slack_get_thread_replies", {
    channel: "C1",
    parent_ts: "1772746316.035959",
  });
  assert.equal(out["thread_ts"], "1772746316.035959");
});

test("normalizeSlackRestToolArgs maps channels to channel for upload", () => {
  const out = normalizeSlackRestToolArgs("slack_upload_file", {
    channels: "C1",
    filename: "a.txt",
    content: "x",
  });
  assert.equal(out["channel"], "C1");
});
