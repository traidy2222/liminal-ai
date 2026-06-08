import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMimeMessage,
  decodeHtmlEntities,
  decodeMimeHeaderValue,
  encodeRfc822HeaderValue,
  extractEmailBody,
  htmlToPlainText,
  humanizeOutboundEmailCopy,
  repairEmailUnicode,
} from "./gmail_message_body.js";

function decodeRaw(b64url: string): string {
  return Buffer.from(b64url, "base64url").toString("utf8");
}

test("htmlToPlainText strips tags and entities", () => {
  const html = "<p>Hello&nbsp;world &amp; <b>friends</b></p><p>Line&#8217;s two</p>";
  const plain = htmlToPlainText(html);
  assert.match(plain, /Hello world & friends/);
  assert.match(plain, /Line.s two/i);
});

test("extractEmailBody prefers plain over html", () => {
  const body = extractEmailBody({
    mimeType: "multipart/alternative",
    parts: [
      {
        mimeType: "text/plain",
        body: { data: Buffer.from("Plain text", "utf8").toString("base64url") },
      },
      {
        mimeType: "text/html",
        body: {
          data: Buffer.from("<p>HTML only</p>", "utf8").toString("base64url"),
        },
      },
    ],
  });
  assert.equal(body, "Plain text");
});

test("extractEmailBody converts html when no plain part", () => {
  const body = extractEmailBody({
    mimeType: "text/html",
    headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
    body: {
      data: Buffer.from("<div>Hi&nbsp;there</div>", "utf8").toString("base64url"),
    },
  });
  assert.equal(body, "Hi there");
});

test("decodeMimeHeaderValue decodes UTF-8 B encoded subject", () => {
  const enc = "=?UTF-8?B?4piZIEhlbGxv?="; // ✨ Hello
  const dec = decodeMimeHeaderValue(enc);
  assert.match(dec, /Hello/);
});

test("encodeRfc822HeaderValue wraps non-ASCII", () => {
  const enc = encodeRfc822HeaderValue("Réunion demain");
  assert.match(enc, /^=\?UTF-8\?B\?/);
});

test("buildMimeMessage: plain-only stays text/plain", () => {
  const raw = decodeRaw(buildMimeMessage({ to: ["a@b.com"], subject: "Hi", text: "Hello" }));
  assert.match(raw, /^To: a@b\.com/m);
  assert.match(raw, /Content-Type: text\/plain; charset="utf-8"/);
  assert.doesNotMatch(raw, /multipart/);
});

test("buildMimeMessage: html builds multipart/alternative with derived plain fallback", () => {
  const raw = decodeRaw(
    buildMimeMessage({ to: ["a@b.com"], subject: "Card", html: "<h1>Happy Birthday</h1>" })
  );
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-Type: text\/plain/);
  assert.match(raw, /Content-Type: text\/html/);
  // Bodies are base64-encoded; the html content round-trips into the message.
  const htmlB64 = Buffer.from("<h1>Happy Birthday</h1>", "utf8").toString("base64");
  assert.ok(raw.includes(htmlB64), "html body should be base64-embedded");
});

test("buildMimeMessage: inline image nests alternative inside multipart/related", () => {
  const raw = decodeRaw(
    buildMimeMessage({
      to: ["a@b.com"],
      subject: "Card",
      html: '<img src="cid:hero">',
      inlineImages: [{ data: Buffer.from([1, 2, 3]), mimeType: "image/png", contentId: "hero" }],
    })
  );
  assert.match(raw, /Content-Type: multipart\/related/);
  assert.match(raw, /Content-Type: multipart\/alternative/);
  assert.match(raw, /Content-ID: <hero>/);
  assert.match(raw, /Content-Disposition: inline/);
});

test("buildMimeMessage: attachment wraps in multipart/mixed", () => {
  const raw = decodeRaw(
    buildMimeMessage({
      to: ["a@b.com"],
      subject: "Doc",
      text: "see attached",
      attachments: [{ data: Buffer.from("hi"), mimeType: "application/pdf", filename: "f.pdf" }],
    })
  );
  assert.match(raw, /Content-Type: multipart\/mixed/);
  assert.match(raw, /Content-Disposition: attachment; filename="f\.pdf"/);
});

test("repairEmailUnicode fixes Shift-JIS-style em dash mojibake", () => {
  const bad = "hope the experience \uFFE2\uFF80\uFF94 and the team \uFFE2\uFF80\uFF94";
  const fixed = repairEmailUnicode(bad);
  assert.match(fixed, /experience — and the team —/);
});

test("repairEmailUnicode fixes Latin-1 misread UTF-8 em dash", () => {
  const bad = String.fromCharCode(0xe2, 0x80, 0x94);
  assert.equal(repairEmailUnicode(`Line${bad}end`), "Line—end");
});

test("humanizeOutboundEmailCopy replaces em dashes with commas", () => {
  assert.equal(
    humanizeOutboundEmailCopy("hope the experience — and the team — resonated"),
    "hope the experience, and the team, resonated"
  );
  assert.equal(humanizeOutboundEmailCopy("Hi&mdash;there"), "Hi, there");
});

test("buildMimeMessage repairs mojibake and humanizes dashes in bodies", () => {
  const dash = "\uFFE2\uFF80\uFF94";
  const raw = decodeRaw(
    buildMimeMessage({
      to: ["a@b.com"],
      subject: `Re${dash}`,
      text: `Hello${dash}world`,
      html: `<p>Hi${dash}there</p>`,
    })
  );
  const plainB64 = Buffer.from("Hello, world", "utf8").toString("base64");
  const htmlB64 = Buffer.from("<p>Hi, there</p>", "utf8").toString("base64");
  assert.ok(raw.replace(/\r\n/g, "").includes(plainB64), "plain body should humanize dashes");
  assert.ok(raw.replace(/\r\n/g, "").includes(htmlB64), "html body should humanize dashes");
});

test("decodeHtmlEntities decodes named dashes and quotes", () => {
  assert.equal(decodeHtmlEntities("&mdash; &ndash; &rsquo;"), "\u2014 \u2013 \u2019");
});

test("buildMimeMessage: cc/bcc/inReplyTo headers", () => {
  const raw = decodeRaw(
    buildMimeMessage({
      to: ["a@b.com"],
      cc: ["c@d.com"],
      bcc: ["e@f.com"],
      subject: "Re: x",
      text: "ok",
      inReplyTo: "<msg-123@mail>",
    })
  );
  assert.match(raw, /^Cc: c@d\.com/m);
  assert.match(raw, /^Bcc: e@f\.com/m);
  assert.match(raw, /^In-Reply-To: <msg-123@mail>/m);
  assert.match(raw, /^References: <msg-123@mail>/m);
});
