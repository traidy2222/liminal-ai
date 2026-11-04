import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_MANAGED_ENV_KEYS } from "./harness_env_inventory.js";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
import { HARNESS_SETTINGS_FIELD_META } from "./harness_settings_field_meta.js";
import { buildHarnessSettingsApiFields } from "./harness_settings_api.js";

test("metadata regeneration retains the local voice fields and single-model explanation", () => {
  const directory=mkdtempSync(path.join(tmpdir(),"liminal-voice-metadata-"));
  try {
    const output=path.join(directory,"generated.ts");
    const root=fileURLToPath(new URL("../../../",import.meta.url));
    execFileSync(process.execPath,[path.join(root,"scripts/gen-harness-settings-meta.mjs"),"--output",output],{cwd:root});
    const source=readFileSync(output,"utf8");
    for(const key of ["AGENT_TTS_MODEL","AGENT_TTS_VOICE","AGENT_SINGLE_MODEL","AGENT_TRANSCRIBE_MODEL","AGENT_TRANSCRIBE_LANGUAGE"] as const){
      const block=source.split(`  "${key}": {`)[1]?.split("\n  },")[0];
      assert.ok(block,`Missing generated ${key}`);
      for(const field of ["tabId","subgroupId","label","description","valueKind"] as const){
        const value=block.match(new RegExp(`${field}: ("(?:[^"\\\\]|\\\\.)*")`))?.[1];
        assert.ok(value,`${key}.${field}`);
        assert.equal(JSON.parse(value),HARNESS_SETTINGS_FIELD_META[key]![field]);
      }
    }
    assert.ok(source.includes('voice: "Response & voice"'));
  } finally { rmSync(directory,{recursive:true,force:true}); }
});

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

test("every managed env key has a product default and non-blank settings value", () => {
  for (const k of HARNESS_MANAGED_ENV_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(HARNESS_ENV_DEFAULTS, k),
      `missing HARNESS_ENV_DEFAULTS[${k}]`
    );
  }
  for (const row of buildHarnessSettingsApiFields(null)) {
    assert.ok(row.productDefault !== null, `productDefault null for ${row.key}`);
    if (row.productDefault !== "") {
      assert.notEqual(row.value, "", `blank value for ${row.key}`);
    }
  }
});
