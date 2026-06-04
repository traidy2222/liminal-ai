import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGoogleServices,
  scopesForGoogleServices,
  needsGoogleSidecar,
  getGoogleServicePreset,
} from "./connector_catalog.js";

describe("connector_catalog", () => {
  it("resolves drive to official MCP", () => {
    const presets = resolveGoogleServices(["drive"]);
    assert.equal(presets.length, 1);
    assert.equal(presets[0]!.backend, "google_official_mcp");
    assert.ok(presets[0]!.mcpUrl?.includes("drivemcp"));
  });

  it("resolves sheets to sidecar connection name google_ext", () => {
    const preset = getGoogleServicePreset("sheets");
    assert.equal(preset?.backend, "google_sidecar");
    assert.equal(preset?.connectionName, "google_ext");
  });

  it("dedupes sidecar services to one connection", () => {
    const presets = resolveGoogleServices(["docs", "sheets", "slides"]);
    const ext = presets.filter((p) => p.connectionName === "google_ext");
    assert.equal(ext.length, 3);
  });

  it("needsGoogleSidecar when productivity services included", () => {
    assert.equal(needsGoogleSidecar(resolveGoogleServices(["drive"])), false);
    assert.equal(needsGoogleSidecar(resolveGoogleServices(["sheets"])), true);
  });

  it("read_only scopes prefer readonly variants", () => {
    const presets = resolveGoogleServices(["drive", "gmail"]);
    const scopes = scopesForGoogleServices(presets, "read_only");
    assert.ok(scopes.some((s) => s.includes("readonly")));
  });
});
