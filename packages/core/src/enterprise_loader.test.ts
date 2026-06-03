import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { tierRequiresEnterprisePackage } from "./enterprise_install.js";
import { resolveEnterpriseRoots, entrypointForRoot } from "./enterprise_loader.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

describe("enterprise open-core loader", () => {
  it("tierRequiresEnterprisePackage is false for community", () => {
    assert.equal(tierRequiresEnterprisePackage("community"), false);
  });

  it("tierRequiresEnterprisePackage is true for pro+", () => {
    assert.equal(tierRequiresEnterprisePackage("pro"), true);
    assert.equal(tierRequiresEnterprisePackage("team"), true);
    assert.equal(tierRequiresEnterprisePackage("enterprise"), true);
  });

  it("resolveEnterpriseRoots includes workspace enterprise package path", () => {
    const roots = resolveEnterpriseRoots();
    const expected = path.join(resolveWorkspaceRoot(), "packages", "enterprise");
    assert.ok(
      roots.some((r) => path.normalize(r) === path.normalize(expected)),
      `expected ${expected} in ${roots.join(", ")}`
    );
  });

  it("entrypointForRoot points at dist/index.js", () => {
    assert.equal(entrypointForRoot("/foo"), path.join("/foo", "dist", "index.js"));
  });
});
