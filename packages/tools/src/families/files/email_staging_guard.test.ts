import assert from "node:assert/strict";
import test from "node:test";
import { rejectWorkspaceEmailStaging } from "./email_staging_guard.js";

test("rejectWorkspaceEmailStaging blocks email html files", () => {
  const err = rejectWorkspaceEmailStaging(
    "outreach/fireworks-email.html",
    "<!DOCTYPE html><html><body><table><tr><td>Dear team</td></tr></table></body></html>"
  );
  assert.ok(err);
  assert.match(err!, /gmail_create_draft/i);
});

test("rejectWorkspaceEmailStaging allows normal code html", () => {
  const err = rejectWorkspaceEmailStaging(
    "src/index.html",
    "<!DOCTYPE html><html><body><div id='app'></div></body></html>"
  );
  assert.equal(err, null);
});
