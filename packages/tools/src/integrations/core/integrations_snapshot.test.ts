import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveIntegrationProviderStatuses } from "./integrations_snapshot.js";

const emptyIda = {
  sidecar: { enabled: true, running: false, port: 8745, url: "http://127.0.0.1:8745/mcp" },
  enabled: true,
  guiReachable: false,
};

describe("deriveIntegrationProviderStatuses", () => {
  it("separates oauth sign-in from mcp tool attach for workspace providers", () => {
    const status = deriveIntegrationProviderStatuses({
      google: { accounts: [{ accountId: "g1", scopes: [], expiresAt: 0 }] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      ida: emptyIda,
      xero: { accounts: [] },
      slack: { accounts: [] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      youtube: { accounts: [] },
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
  });

  it("treats oauth_auto_attach workspace providers as ready when signed in", () => {
    const signedInOnly = deriveIntegrationProviderStatuses({
      google: { accounts: [{ accountId: "g1", scopes: [], expiresAt: 0 }] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      ida: emptyIda,
      xero: { accounts: [] },
      slack: { accounts: [] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      youtube: { accounts: [] },
      connections: [],
    });
    assert.equal(signedInOnly.google?.connectMode, "oauth_auto_attach");
    assert.equal(signedInOnly.google?.signedIn, true);
    assert.equal(signedInOnly.google?.ready, true);
    assert.equal(signedInOnly.google?.toolsAttached, true);
  });

  it("treats oauth_auto_attach providers as ready when signed in", () => {
    const status = deriveIntegrationProviderStatuses({
      google: { accounts: [] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      ida: emptyIda,
      xero: { accounts: [] },
      slack: { accounts: [{ accountId: "s1", scopes: [], expiresAt: 0 }] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      youtube: { accounts: [] },
      connections: [],
    });
    assert.equal(status.slack?.connectMode, "oauth_auto_attach");
    assert.equal(status.slack?.ready, true);
  });

  it("ida signedIn reflects enabled + reachable server, ready when tools attached", () => {
    const offline = deriveIntegrationProviderStatuses({
      google: { accounts: [] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      ida: { ...emptyIda, enabled: false },
      xero: { accounts: [] },
      slack: { accounts: [] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      youtube: { accounts: [] },
      connections: [],
    });
    assert.equal(offline.ida?.signedIn, false);
    assert.equal(offline.ida?.ready, false);

    const gui = deriveIntegrationProviderStatuses({
      google: { accounts: [] },
      microsoft: { accounts: [] },
      azure: { accounts: [] },
      github: { accounts: [] },
      ida: { ...emptyIda, guiReachable: true },
      xero: { accounts: [] },
      slack: { accounts: [] },
      linear: { accounts: [] },
      notion: { accounts: [] },
      youtube: { accounts: [] },
      connections: [
        {
          kind: "mcp",
          name: "ida",
          toolCount: 40,
          sampleTools: [],
          authKind: "none",
          attachedAt: 1,
          parentProvider: "ida",
        },
      ],
    });
    assert.equal(gui.ida?.signedIn, true);
    assert.equal(gui.ida?.toolsAttached, true);
    assert.equal(gui.ida?.ready, true);
  });
});
