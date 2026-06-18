import { describe, expect, it } from "vitest";
import {
  filterGoogleMailAccounts,
  filterMicrosoftMailAccounts,
  googleAccountHasMailScopes,
  isEntraGuestMailbox,
  microsoftAccountHasMailScopes,
} from "./mail_oauth_filter.js";

const GMAIL_MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const MAIL_READ = "Mail.Read";

describe("mail_oauth_filter", () => {
  it("detects gmail mail scopes", () => {
    expect(googleAccountHasMailScopes([GMAIL_MODIFY])).toBe(true);
    expect(googleAccountHasMailScopes(["https://www.googleapis.com/auth/drive.file"])).toBe(false);
  });

  it("detects microsoft mail scopes", () => {
    expect(microsoftAccountHasMailScopes([MAIL_READ])).toBe(true);
    expect(microsoftAccountHasMailScopes(["User.Read"])).toBe(false);
  });

  it("excludes Entra guest mailboxes from microsoft pool", () => {
    const accounts = [
      {
        accountId: "guest",
        email: "admin_vireondynamics.com#EXT#@adminvireondynamics.onmicrosoft.com",
        scopes: [MAIL_READ],
      },
      { accountId: "real", email: "you@company.com", scopes: [MAIL_READ] },
    ];
    expect(filterMicrosoftMailAccounts(accounts).map((a) => a.accountId)).toEqual(["real"]);
  });

  it("filters google accounts without gmail scopes", () => {
    const accounts = [
      { accountId: "g1", scopes: [GMAIL_MODIFY] },
      { accountId: "g2", scopes: ["https://www.googleapis.com/auth/calendar"] },
    ];
    expect(filterGoogleMailAccounts(accounts).map((a) => a.accountId)).toEqual(["g1"]);
  });

  it("flags Entra guest emails", () => {
    expect(isEntraGuestMailbox("foo#EXT#@bar.onmicrosoft.com")).toBe(true);
    expect(isEntraGuestMailbox("you@gmail.com")).toBe(false);
  });
});
