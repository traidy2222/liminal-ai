import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isGmailThreadReply,
  isSubstantivePlainBody,
  looksLikeFormattedEmailHtml,
  validateOutboundEmailFactual,
  validateOutboundEmailStyle,
} from "./gmail_compose_guard.js";

test("looksLikeFormattedEmailHtml detects table layout", () => {
  const html = `<table width="600"><tr><td style="padding:16px">Hi</td></tr></table>`;
  assert.equal(looksLikeFormattedEmailHtml(html), true);
  assert.equal(looksLikeFormattedEmailHtml("<p>Hello world</p>"), false);
});

test("looksLikeFormattedEmailHtml accepts minimal tier styled paragraphs", () => {
  const html = `<p style="margin:0 0 16px;font-family:Georgia,serif;color:#444;line-height:1.5">Thanks again for your time.</p>`;
  assert.equal(looksLikeFormattedEmailHtml(html), true);
});

test("validateOutboundEmailStyle rejects substantive plain new mail", () => {
  const err = validateOutboundEmailStyle({
    to: ["a@b.com"],
    subject: "Hello",
    body: "Dear team,\n\nThanks for your time yesterday.\n\nBest,\nAlex",
  });
  assert.ok(err);
  assert.match(err!, /body_html/i);
});

test("validateOutboundEmailStyle allows thread reply plain", () => {
  const err = validateOutboundEmailStyle({
    to: ["a@b.com"],
    subject: "Re: ok",
    body: "Tuesday works for me — see you then.",
    thread_id: "abc123",
  });
  assert.equal(err, null);
});

test("validateOutboundEmailStyle allows formatted html", () => {
  const html = `<table width="600" style="margin:0 auto"><tr><td bgcolor="#1a1a2e" style="padding:24px;color:#fff"><h1 style="margin:0">Hello</h1></td></tr><tr><td bgcolor="#ffffff" style="padding:24px;color:#333333"><p>Body copy</p></td></tr></table>`;
  const err = validateOutboundEmailStyle({
    to: ["a@b.com"],
    subject: "Invite",
    body: "Hello",
    body_html: html,
  });
  assert.equal(err, null);
});

test("validateOutboundEmailStyle allows light text on table layout", () => {
  const html = `<table bgcolor="#1a1a2e"><tr><td><p style="color:#e0e0e0;line-height:1.6">Hey,</p><p style="color:#e0e0e0">Your inbox just got autonomous.</p></td></tr></table>`;
  const err = validateOutboundEmailStyle({
    to: ["a@b.com"],
    subject: "Test",
    body: "Hi",
    body_html: html,
  });
  assert.equal(err, null);
});

test("validateOutboundEmailFactual rejects placeholder repo URLs", () => {
  const err = validateOutboundEmailFactual({
    to: ["a@b.com"],
    subject: "Hello",
    body: "See https://github.com/GITHUB_USERNAME/REPO_PLACEHOLDER",
  });
  assert.ok(err);
  assert.match(err!, /placeholder/i);
});

test("isGmailThreadReply detects thread_id", () => {
  assert.equal(isGmailThreadReply({ thread_id: "t1" }), true);
  assert.equal(isGmailThreadReply({ to: ["a@b.com"] }), false);
});

test("isSubstantivePlainBody allows one-liners", () => {
  assert.equal(isSubstantivePlainBody("Tuesday works"), false);
  assert.equal(isSubstantivePlainBody("Dear team,\n\nLong paragraph here."), true);
});
