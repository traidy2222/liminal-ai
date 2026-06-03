import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertLicenseOrgMatch,
  assertTeamSyncablePayload,
  isTeamSyncableScope,
  TeamMemoryPolicyError,
} from "./team_memory_helpers.js";
import type { LicenseAuthedRequest } from "./license_auth.js";

describe("team_memory_helpers", () => {
  it("isTeamSyncableScope rejects chat", () => {
    assert.equal(isTeamSyncableScope("chat"), false);
    assert.equal(isTeamSyncableScope("workspace"), true);
    assert.equal(isTeamSyncableScope("global"), true);
  });

  it("assertTeamSyncablePayload rejects chat scope", () => {
    assert.throws(
      () => assertTeamSyncablePayload({ scope: "chat", value: "x" }, "fact:1"),
      TeamMemoryPolicyError
    );
  });

  it("assertLicenseOrgMatch rejects mismatched org", () => {
    const req = {
      licenseResolved: { license: { org: "org-a" } },
    } as LicenseAuthedRequest;
    assert.throws(() => assertLicenseOrgMatch(req, "org-b"), TeamMemoryPolicyError);
  });

  it("assertLicenseOrgMatch allows matching org", () => {
    const req = {
      licenseResolved: { license: { org: "org-a" } },
    } as LicenseAuthedRequest;
    assert.doesNotThrow(() => assertLicenseOrgMatch(req, "org-a"));
  });
});
