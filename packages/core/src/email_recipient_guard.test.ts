import assert from "node:assert/strict";
import test from "node:test";
import {
  collectOutboundRecipientEmails,
  isCredibleRecipientSource,
  isRoleMailboxAddress,
  validateEmailAddressFormat,
  validateOutboundEmailRecipients,
} from "./email_recipient_guard.js";

test("validateEmailAddressFormat rejects placeholders", () => {
  assert.ok(validateEmailAddressFormat("user@example.com"));
  assert.equal(validateEmailAddressFormat("bad"), "Invalid email format: bad");
});

test("isRoleMailboxAddress detects common guesses", () => {
  assert.equal(isRoleMailboxAddress("partners@lmstudio.ai"), true);
  assert.equal(isRoleMailboxAddress("trai@vireondynamics.com"), false);
});

test("isCredibleRecipientSource accepts user-provided", () => {
  assert.equal(
    isCredibleRecipientSource("user provided the address in chat", ["a@b.com"]),
    true
  );
});

test("isCredibleRecipientSource accepts matching domain URL", () => {
  assert.equal(
    isCredibleRecipientSource(
      "https://lmstudio.ai/contact partners@lmstudio.ai",
      ["partners@lmstudio.ai"]
    ),
    true
  );
});

test("isCredibleRecipientSource accepts quoted email on directory URL", () => {
  assert.equal(
    isCredibleRecipientSource(
      "web_fetch https://www.truelocal.com.au/listing — justine@afocusedbirth.com.au",
      ["justine@afocusedbirth.com.au"]
    ),
    true
  );
});

test("isCredibleRecipientSource accepts directory listing URL without repeating email", () => {
  assert.equal(
    isCredibleRecipientSource(
      "web_fetch https://www.yellowpages.com.au/find/acme-plumbing-wheelers-hill-vic-12345",
      ["info@acmeplumbing.com.au"]
    ),
    true
  );
});

test("isCredibleRecipientSource accepts Google Maps place URL", () => {
  assert.equal(
    isCredibleRecipientSource(
      "https://www.google.com/maps/place/Acme+Plumbing/@-37.8,145.1,15z",
      ["info@acme.com.au"]
    ),
    true
  );
});

test("isCredibleRecipientSource rejects directory homepage only", () => {
  assert.equal(
    isCredibleRecipientSource("https://www.truelocal.com.au", ["info@acme.com.au"]),
    false
  );
});

test("isCredibleRecipientSource accepts com.au official site", () => {
  assert.equal(
    isCredibleRecipientSource(
      "https://www.afocusedbirth.com.au/contact",
      ["justine@afocusedbirth.com.au"]
    ),
    true
  );
});

test("isCredibleRecipientSource accepts recipients_verified string true", () => {
  const err = validateOutboundEmailRecipients(
    {
      to: ["justine@afocusedbirth.com.au"],
      subject: "Hi",
      body_html: "<table><tr><td style='padding:24px'>x</td></tr></table>",
      body: "x",
      recipients_verified: "true" as unknown as boolean,
      recipient_source:
        "justine@afocusedbirth.com.au — https://afocusedbirth.com.au/contact",
    },
    "draft"
  );
  assert.equal(err, null);
});

test("isCredibleRecipientSource rejects bare claims", () => {
  assert.equal(isCredibleRecipientSource("found on their website", ["a@b.com"]), false);
});

test("validateOutboundEmailRecipients blocks all cold send_message", () => {
  const err = validateOutboundEmailRecipients(
    {
      to: ["partners@lmstudio.ai"],
      subject: "Hi",
      body: "Hello",
      recipients_verified: true,
      recipient_source: "https://lmstudio.ai/contact",
    },
    "send"
  );
  assert.ok(err);
  assert.match(err!, /gmail_create_draft/i);
});

test("validateOutboundEmailRecipients allows verified cold draft", () => {
  const err = validateOutboundEmailRecipients(
    {
      to: ["partners@lmstudio.ai"],
      subject: "Hi",
      body: "Hello",
      recipients_verified: true,
      recipient_source: "https://lmstudio.ai/contact lists partners@lmstudio.ai",
    },
    "draft"
  );
  assert.equal(err, null);
});

test("validateOutboundEmailRecipients allows cold draft without verification", () => {
  const err = validateOutboundEmailRecipients(
    {
      to: ["business@fireship.dev"],
      subject: "Hi",
      body_html: "<table><tr><td style='padding:24px'>x</td></tr></table>",
      body: "x",
    },
    "draft"
  );
  assert.equal(err, null);
});

test("thread replies skip recipient verification", () => {
  const err = validateOutboundEmailRecipients(
    {
      to: ["someone@unknown.test"],
      subject: "Re: hi",
      body: "thanks",
      thread_id: "abc",
    },
    "send"
  );
  assert.equal(err, null);
});

test("collectOutboundRecipientEmails gathers cc", () => {
  assert.deepEqual(
    collectOutboundRecipientEmails({ to: ["a@b.com"], cc: ["c@d.com"] }),
    ["a@b.com", "c@d.com"]
  );
});
