import { describe, expect, it } from "vitest";
import {
  isMailInboxTurn,
  isMailReplyContinuationTurn,
  mergeMailSessionContext,
  parseMailSessionFromToolOutput,
  resolveGoogleMailAccount,
  buildMailSessionContextInjection,
} from "./mail_account_context.js";

describe("isMailInboxTurn", () => {
  it("detects inbox review asks", () => {
    expect(isMailInboxTurn("do we have anything to reply to?")).toBe(true);
    expect(isMailInboxTurn("check my gmail inbox")).toBe(true);
  });
});

describe("isMailReplyContinuationTurn", () => {
  it("detects short reply follow-ups", () => {
    expect(isMailReplyContinuationTurn("reply to it")).toBe(true);
    expect(isMailReplyContinuationTurn("send that")).toBe(true);
  });
});

describe("resolveGoogleMailAccount", () => {
  const accounts = [
    { accountId: "a1", email: "first@gmail.com" },
    { accountId: "a2", email: "second@gmail.com" },
  ];

  it("requires account_hint when multiple accounts", () => {
    const r = resolveGoogleMailAccount(undefined, accounts);
    expect("error" in r).toBe(true);
    if ("error" in r) expect(r.error).toContain("account_hint");
  });

  it("resolves by email hint", () => {
    const r = resolveGoogleMailAccount("second@gmail.com", accounts);
    expect("account" in r && r.account.accountId).toBe("a2");
  });

  it("allows single account without hint", () => {
    const r = resolveGoogleMailAccount(undefined, [{ accountId: "solo", email: "solo@gmail.com" }]);
    expect("account" in r && r.account.accountId).toBe("solo");
  });
});

describe("parseMailSessionFromToolOutput", () => {
  it("parses gmail_create_draft output and args", () => {
    const patch = parseMailSessionFromToolOutput(
      "gmail_create_draft",
      JSON.stringify({ account_hint: "work@gmail.com", thread_id: "t123", subject: "Re: Hi" }),
      "Draft created. draftId=d1, messageId=m1, threadId=t123, fromAccount=work@gmail.com"
    );
    expect(patch?.accountEmail).toBe("work@gmail.com");
    expect(patch?.threadId).toBe("t123");
    expect(patch?.provider).toBe("google");
  });

  it("parses mail_search_inboxes hit with mailbox and thread", () => {
    const output = `### Gmail: work@gmail.com (1 match)
- [Project update]
  mailbox=work@gmail.com, messageId=abc123, threadId=thread456
  from=Jane Doe <jane@example.com>, date=Mon, 1 Jan 2024
  snippet=Hey checking in`;
    const patch = parseMailSessionFromToolOutput("mail_search_inboxes", "{}", output);
    expect(patch?.accountEmail).toBe("work@gmail.com");
    expect(patch?.messageId).toBe("abc123");
    expect(patch?.threadId).toBe("thread456");
    expect(patch?.subject).toBe("Project update");
    expect(patch?.fromEmail).toBe("jane@example.com");
  });
});

describe("buildMailSessionContextInjection", () => {
  it("includes account_hint guidance", () => {
    const line = buildMailSessionContextInjection(
      mergeMailSessionContext(null, {
        accountEmail: "work@gmail.com",
        threadId: "t1",
        updatedAt: new Date().toISOString(),
      })
    );
    expect(line).toContain('account_hint="work@gmail.com"');
    expect(line).toContain("thread_id=t1");
  });
});
