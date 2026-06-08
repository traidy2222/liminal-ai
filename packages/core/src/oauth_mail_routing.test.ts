import { describe, expect, it } from "vitest";
import {
  oauthMailboxQualityScore,
  pickBestOAuthAccountByEmail,
} from "./oauth_account_pick.js";

describe("oauth_mail_routing", () => {
  it("prefers gmail over Entra guest admin", () => {
    const accounts = [
      {
        accountId: "ms",
        email: "admin_vireondynamics.com#EXT#@adminvireondynamics.onmicrosoft.com",
      },
      { accountId: "g", email: "you@gmail.com" },
    ];
    expect(pickBestOAuthAccountByEmail(accounts)?.accountId).toBe("g");
    expect(oauthMailboxQualityScore(accounts[0]!.email)).toBeLessThan(
      oauthMailboxQualityScore(accounts[1]!.email)
    );
  });
});
