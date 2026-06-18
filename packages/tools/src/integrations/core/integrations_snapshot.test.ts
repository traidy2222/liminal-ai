import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveIntegrationProviderStatuses } from "./integrations_snapshot.js";

describe("deriveIntegrationProviderStatuses", () => {
  it("separates oauth sign-in from mcp tool attach for workspace providers", () => {
    const status = deriveIntegrationProviderStatuses({
      google: { accounts: [{ accountId: "g1", scopes: [], expiresAt: 0 }] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      xero: { accounts: [] },
      slack: { accounts: [] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      connections: [
        {
          kind: "mcp",
          name: "google_workspace",
          toolCount: 12,
          sampleTools: [],
          authKind: "oauth",
          attachedAt: 1,
          parentProvider: "google_workspace",
        },
      ],
    });
    assert.equal(status.google?.signedIn, true);
    assert.equal(status.google?.toolsAttached, true);
    assert.equal(status.google?.toolCount, 12);
    assert.equal(status.google?.ready, true);

    const signedInOnly = deriveIntegrationProviderStatuses({
      google: { accounts: [{ accountId: "g1", scopes: [], expiresAt: 0 }] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      xero: { accounts: [] },
      slack: { accounts: [] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      connections: [],
    });
    assert.equal(signedInOnly.google?.signedIn, true);
    assert.equal(signedInOnly.google?.toolsAttached, false);
    assert.equal(signedInOnly.google?.ready, false);
  });

  it("treats oauth_auto_attach providers as ready when signed in", () => {
    const status = deriveIntegrationProviderStatuses({
      google: { accounts: [] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      xero: { accounts: [] },
      slack: { accounts: [{ accountId: "s1", scopes: [], expiresAt: 0 }] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      connections: [],
    });
    assert.equal(status.slack?.connectMode, "oauth_auto_attach");
    assert.equal(status.slack?.ready, true);
  });
});
