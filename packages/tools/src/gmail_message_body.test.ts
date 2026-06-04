import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decodeHtmlEntities,
  decodeMimeHeaderValue,
  encodeRfc822HeaderValue,
  extractEmailBody,
  htmlToPlainText,
} from "./gmail_message_body.js";

test("htmlToPlainText strips tags and entities", () => {
  const html = "<p>Hello&nbsp;world &amp; <b>friends</b></p><p>Line&#8217;s two</p>";
  const plain = htmlToPlainText(html);
  assert.match(plain, /Hello world & friends/);
  assert.match(plain, /Line.two/i);
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
