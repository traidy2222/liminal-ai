import test from "node:test";
import assert from "node:assert/strict";
import { HARNESS_MANAGED_ENV_KEYS } from "./harness_env_inventory.js";
import { HARNESS_SETTINGS_FIELD_META } from "./harness_settings_field_meta.js";
import { buildHarnessSettingsApiFields } from "./harness_settings_api.js";

test("every managed env key has settings field metadata", () => {
  for (const k of HARNESS_MANAGED_ENV_KEYS) {
    const m = HARNESS_SETTINGS_FIELD_META[k];
    assert.ok(m, `missing meta for ${k}`);
    assert.ok(m.label.length > 0, k);
    assert.ok(m.description.length > 0, k);
    assert.ok(["boolean", "string", "number", "enum"].includes(m.valueKind), k);
    if (m.valueKind === "enum") {
      assert.ok(m.enumValues && m.enumValues.length > 0, k);
    }
  }
});

test("buildHarnessSettingsApiFields groups by tab then subgroup", () => {
  const rows = buildHarnessSettingsApiFields(null);
  assert.equal(rows.length, HARNESS_MANAGED_ENV_KEYS.length);
  assert.equal(rows[0]?.tabId, "models_api");
  const tabIds = [...new Set(rows.map((r) => r.tabId))];
  assert.ok(tabIds.length >= 5);
  for (const r of rows) {
    assert.ok(r.subgroupLabel.length > 0);
    assert.ok("resolutionSource" in r);
  }
});
