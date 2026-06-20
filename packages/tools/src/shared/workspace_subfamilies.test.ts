import assert from "node:assert/strict";
import test from "node:test";
import {
  googleConnectionSubFamily,
  googleRestToolSubFamily,
  inferGoogleSubFamiliesFromText,
  microsoftMcpToolSubFamily,
  microsoftRestToolSubFamily,
  WORKSPACE_FAMILY_ALIASES,
} from "./workspace_subfamilies.js";

test("googleConnectionSubFamily maps MCP connections", () => {
  assert.equal(googleConnectionSubFamily("google_gmail"), "google_mail");
  assert.equal(googleConnectionSubFamily("google_calendar"), "google_calendar");
  assert.equal(googleConnectionSubFamily("google_ext", ["docs"]), "google_office");
});

test("googleRestToolSubFamily maps REST tools", () => {
  assert.equal(googleRestToolSubFamily("gmail_send_message"), "google_mail");
  assert.equal(googleRestToolSubFamily("calendar_rest_list_events"), "google_calendar");
  assert.equal(googleRestToolSubFamily("sheets_rest_get_values"), "google_office");
});

test("inferGoogleSubFamiliesFromText is task-specific", () => {
  assert.deepEqual(inferGoogleSubFamiliesFromText("check my gmail inbox"), ["google_mail"]);
  assert.ok(inferGoogleSubFamiliesFromText("update the spreadsheet").includes("google_office"));
});

test("microsoftMcpToolSubFamily heuristics", () => {
  assert.equal(microsoftMcpToolSubFamily("mcp_microsoft_list_mail_messages"), "microsoft_mail");
  assert.equal(microsoftMcpToolSubFamily("mcp_microsoft_create_calendar_event"), "microsoft_calendar");
});

test("workspace aliases cover sub-families", () => {
  assert.ok(WORKSPACE_FAMILY_ALIASES.google_workspace?.includes("google_mail"));
  assert.ok(WORKSPACE_FAMILY_ALIASES.microsoft_365?.includes("microsoft_mail"));
});

test("microsoftRestToolSubFamily maps REST tools", () => {
  assert.equal(microsoftRestToolSubFamily("outlook_send_message"), "microsoft_mail");
  assert.equal(microsoftRestToolSubFamily("onedrive_rest_list_children"), "microsoft_files");
});
