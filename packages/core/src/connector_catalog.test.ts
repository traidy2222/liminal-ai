import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveGoogleServices,
  scopesForGoogleServices,
  needsGoogleSidecar,
  getGoogleServicePreset,
  workspaceMcpToolNamesForServices,
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

  it("includes every sidecar service for scopes and tool selection", () => {
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

  it("read_write calendar includes event write scope", () => {
    const presets = resolveGoogleServices(["calendar"]);
    const scopes = scopesForGoogleServices(presets, "read_write");
    assert.ok(scopes.includes("https://www.googleapis.com/auth/calendar.events"));
  });

  it("read_write drive includes full drive scope", () => {
    const presets = resolveGoogleServices(["drive"]);
    const scopes = scopesForGoogleServices(presets, "read_write");
    assert.ok(scopes.includes("https://www.googleapis.com/auth/drive"));
  });

  it("docs preset includes drive.readonly for file discovery", () => {
    const preset = getGoogleServicePreset("docs");
    assert.ok(preset?.scopes.includes("https://www.googleapis.com/auth/drive.readonly"));
  });

  it("workspaceMcpToolNamesForServices filters to sidecar ids", () => {
    const names = workspaceMcpToolNamesForServices(["docs", "drive", "sheets"]);
    assert.deepEqual(names, ["docs", "sheets"]);
  });

  it("workspaceMcpToolNamesForServices maps apps_script to appscript for workspace-mcp CLI", () => {
    const names = workspaceMcpToolNamesForServices(["apps_script", "docs"]);
    assert.deepEqual(names, ["appscript", "docs"]);
  });
});
