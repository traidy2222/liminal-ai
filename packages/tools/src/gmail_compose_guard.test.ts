import assert from "node:assert/strict";
import { test } from "node:test";
import {
  hasBrokenEmailContrast,
  isGmailThreadReply,
  isSubstantivePlainBody,
  looksLikeFormattedEmailHtml,
  validateOutboundEmailStyle,
} from "./gmail_compose_guard.js";

test("looksLikeFormattedEmailHtml detects table layout", () => {
  const html = `<table width="600"><tr><td style="padding:16px">Hi</td></tr></table>`;
  assert.equal(looksLikeFormattedEmailHtml(html), true);
  assert.equal(looksLikeFormattedEmailHtml("<p>Hello world</p>"), false);
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

test("hasBrokenEmailContrast rejects light text without local dark bgcolor", () => {
  const broken = `<table bgcolor="#1a1a2e"><tr><td><p style="color:#e0e0e0;line-height:1.6">Hey,</p><p style="color:#e0e0e0">Your inbox just got autonomous.</p></td></tr></table>`;
  assert.equal(hasBrokenEmailContrast(broken), true);
  const err = validateOutboundEmailStyle({
    to: ["a@b.com"],
    subject: "Test",
    body: "Hi",
    body_html: broken,
  });
  assert.match(err!, /same cell/i);
});

test("hasBrokenEmailContrast allows self-contained dark td", () => {
  const ok = `<table><tr><td bgcolor="#1a1a2e" style="color:#ffffff;padding:20px">Header</td></tr></table>`;
  assert.equal(hasBrokenEmailContrast(ok), false);
});

test("isGmailThreadReply detects thread_id", () => {
  assert.equal(isGmailThreadReply({ thread_id: "t1" }), true);
  assert.equal(isGmailThreadReply({ to: ["a@b.com"] }), false);
});

test("isSubstantivePlainBody allows one-liners", () => {
  assert.equal(isSubstantivePlainBody("Tuesday works"), false);
  assert.equal(isSubstantivePlainBody("Dear team,\n\nLong paragraph here."), true);
});
