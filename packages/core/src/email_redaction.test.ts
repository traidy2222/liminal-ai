import { describe, expect, it } from "vitest";
import {
  isEmailPrivacyTurn,
  redactMailSearchToolOutput,
  redactSensitiveEmailContent,
} from "./email_redaction.js";

describe("isEmailPrivacyTurn", () => {
  it("detects redact-sensitive phrasing", () => {
    expect(isEmailPrivacyTurn("show my emails and redact sensitive details")).toBe(true);
    expect(isEmailPrivacyTurn("list inbox without sensitive info")).toBe(true);
  });
});

describe("redactSensitiveEmailContent", () => {
  it("redacts SSN and card numbers", () => {
    const s = "SSN 123-45-6789 card 4111 1111 1111 1111";
    const r = redactSensitiveEmailContent(s);
    expect(r).not.toContain("123-45-6789");
    expect(r).not.toContain("4111 1111 1111 1111");
    expect(r).toContain("[REDACTED]");
  });

  it("masks email addresses", () => {
    const r = redactSensitiveEmailContent("contact jane.doe@example.com please");
    expect(r).toContain("j***@example.com");
    expect(r).not.toContain("jane.doe@example.com");
  });

  it("redacts labeled passwords", () => {
    const r = redactSensitiveEmailContent("password: SuperSecret123!");
    expect(r).toContain("password=[REDACTED]");
  });
});

describe("redactMailSearchToolOutput", () => {
  it("keeps routing ids, redacts snippet", () => {
    const raw = `- [Wire transfer 4111111111111111]
  mailbox=user@gmail.com, messageId=abc, threadId=t1
  from=Jane <jane@bank.com>, date=Mon
  snippet=Your SSN is 123-45-6789 call 555-123-4567`;
    const r = redactMailSearchToolOutput(raw);
    expect(r).toContain("messageId=abc");
    expect(r).toContain("mailbox=user@gmail.com");
    expect(r).not.toContain("123-45-6789");
    expect(r).not.toContain("555-123-4567");
  });
});
