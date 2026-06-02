import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tierRequiresEnterprisePackage } from "./enterprise_install.js";
import { resolveEnterpriseRoots, entrypointForRoot } from "./enterprise_loader.js";

describe("enterprise open-core loader", () => {
  it("tierRequiresEnterprisePackage is false for community", () => {
    assert.equal(tierRequiresEnterprisePackage("community"), false);
  });

  it("tierRequiresEnterprisePackage is true for pro+", () => {
    assert.equal(tierRequiresEnterprisePackage("pro"), true);
    assert.equal(tierRequiresEnterprisePackage("team"), true);
    assert.equal(tierRequiresEnterprisePackage("enterprise"), true);
  });

  it("resolveEnterpriseRoots includes env, global, and workspace paths", () => {
    const prev = process.env["AGENT_ENTERPRISE_DIR"];
    process.env["AGENT_ENTERPRISE_DIR"] = "/tmp/ee-test";
    try {
      const roots = resolveEnterpriseRoots();
      assert.ok(roots.some((r) => r.endsWith(path.join("packages", "enterprise"))));
      assert.ok(roots.includes("/tmp/ee-test"));
    } finally {
      if (prev === undefined) delete process.env["AGENT_ENTERPRISE_DIR"];
      else process.env["AGENT_ENTERPRISE_DIR"] = prev;
    }
  });

  it("entrypointForRoot points at dist/index.js", () => {
    assert.equal(entrypointForRoot("/foo"), path.join("/foo", "dist", "index.js"));
  });
});
