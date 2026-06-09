import assert from "node:assert/strict";
import { test } from "node:test";
import {
  linearIssueRef,
  normalizeLinearRestToolArgs,
  validateLinearToolArgs,
} from "./linear_tool_args.js";

test("normalizeLinearRestToolArgs maps issue identifier to issue_id", () => {
  const out = normalizeLinearRestToolArgs("linear_add_comment", {
    issue: "ENG-42",
    body: "hi",
  });
  assert.equal(out.issue_id, "ENG-42");
});

test("normalizeLinearRestToolArgs maps assignee_email for assign", () => {
  const out = normalizeLinearRestToolArgs("linear_assign_issue", {
    issue_id: "ENG-1",
    assignee_email: "alice@co.com",
  });
  assert.equal(out.assignee_email, "alice@co.com");
});

test("normalizeLinearRestToolArgs maps state_name on update", () => {
  const out = normalizeLinearRestToolArgs("linear_update_issue", {
    issue_id: "uuid",
    status: "Done",
  });
  assert.equal(out.state_name, "Done");
});

test("linearIssueRef prefers issue over issue_id", () => {
  assert.equal(linearIssueRef({ issue: "A-1", issue_id: "uuid" }), "A-1");
});

test("normalizeLinearRestToolArgs maps parent_issue on link_sub_issue", () => {
  const out = normalizeLinearRestToolArgs("linear_link_sub_issue", {
    issue: "ENG-2",
    parent: "ENG-1",
  });
  assert.equal(out.parent_issue, "ENG-1");
});

test("normalizeLinearRestToolArgs maps comma labels on set_issue_labels", () => {
  const out = normalizeLinearRestToolArgs("linear_set_issue_labels", {
    issue_id: "ENG-1",
    labels: "bug, urgent",
  });
  assert.deepEqual(out.label_names, ["bug", "urgent"]);
});

test("normalizeLinearRestToolArgs maps team_key on create_issue", () => {
  const out = normalizeLinearRestToolArgs("linear_create_issue", {
    team: "eng",
    title: "Fix",
  });
  assert.equal(out.team_key, "ENG");
});

test("validateLinearToolArgs accepts issue_id only for get_issue", () => {
  const args = normalizeLinearRestToolArgs("linear_get_issue", { issue_id: "VIP-1" });
  assert.equal(validateLinearToolArgs("linear_get_issue", args), null);
});

test("validateLinearToolArgs accepts priority on create_issue", () => {
  const args = normalizeLinearRestToolArgs("linear_create_issue", {
    team_key: "VIP",
    title: "Test",
    priority: "2",
  });
  assert.equal(args.priority, 2);
  assert.equal(validateLinearToolArgs("linear_create_issue", args), null);
});
