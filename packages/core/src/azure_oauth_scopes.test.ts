import { describe, expect, it } from "vitest";
import { resolveAzureServices } from "./azure_connector_catalog.js";
import { missingAzureScopes, missingDefaultAzureScopes } from "./azure_oauth_scopes.js";

describe("azure_oauth_scopes", () => {
  it("flags missing ARM delegated scope", () => {
    const presets = resolveAzureServices(["all"]);
    const missing = missingAzureScopes(["User.Read"], presets);
    expect(missing.length).toBeGreaterThan(0);
    expect(missingDefaultAzureScopes(["User.Read"]).length).toBe(1);
  });

  it("accepts granted ARM scope", () => {
    const presets = resolveAzureServices(["compute"]);
    const missing = missingAzureScopes(
      ["https://management.azure.com/user_impersonation"],
      presets
    );
    expect(missing).toEqual([]);
  });
});
