import type { RuntimePreferences } from "./runtime_prefs.js";
import { HARNESS_ENV_DEFAULTS } from "./harness_default_constants.js";
import { HARNESS_MANAGED_ENV_KEYS } from "./harness_env_inventory.js";
import { harnessEnvResolutionMeta, type HarnessEnvResolutionSource } from "./harness_effective_env.js";
import {
  HARNESS_SETTINGS_FIELD_META,
  HARNESS_SETTINGS_TABS,
  harnessSettingsSubgroupLabel,
  type HarnessSettingsTabId,
  type HarnessSettingsValueKind,
} from "./harness_settings_field_meta.js";

export interface HarnessSettingsApiField {
  key: string;
  value: string;
  lockedByEnv: boolean;
  resolutionSource: HarnessEnvResolutionSource;
  label: string;
  description: string;
  tabId: HarnessSettingsTabId;
  subgroupId: string;
  subgroupLabel: string;
  valueKind: HarnessSettingsValueKind;
  enumValues?: readonly string[];
  numericBounds?: { min?: number; max?: number; step?: number };
  /** Product default string when defined; otherwise null (no built-in default). */
  productDefault: string | null;
  /** Short human summary of the effective value (e.g. On/Off for booleans). */
  effectiveDisplay: string;
}

const TAB_ORDER: HarnessSettingsTabId[] = HARNESS_SETTINGS_TABS.map((t) => t.id);

function effectiveDisplayFor(valueKind: HarnessSettingsValueKind, raw: string): string {
  const t = raw.trim();
  if (valueKind === "boolean") {
    if (t === "1" || t.toLowerCase() === "on" || t.toLowerCase() === "yes") return "On";
    if (t === "0" || t.toLowerCase() === "off" || t.toLowerCase() === "no") return "Off";
  }
  if (t === "") return "—";
  return raw;
}

/**
 * Flat list of harness env fields for `GET /api/settings` (web Settings modal).
 * Sorted by tab, subgroup, then key.
 */
export function buildHarnessSettingsApiFields(prefs: RuntimePreferences | null): HarnessSettingsApiField[] {
  const rows: HarnessSettingsApiField[] = [];
  for (const key of HARNESS_MANAGED_ENV_KEYS) {
    const meta = HARNESS_SETTINGS_FIELD_META[key];
    const res = harnessEnvResolutionMeta(key, prefs);
    const pdRaw = HARNESS_ENV_DEFAULTS[key];
    const hasProductDefault = pdRaw !== undefined;
    const productDefault = hasProductDefault ? pdRaw! : null;
    const val =
      res.value !== undefined && res.value !== ""
        ? res.value
        : hasProductDefault
          ? pdRaw!
          : "";
    rows.push({
      key,
      value: val,
      lockedByEnv: res.lockedByEnv,
      resolutionSource: res.source,
      label: meta.label,
      description: meta.description,
      tabId: meta.tabId,
      subgroupId: meta.subgroupId,
      subgroupLabel: harnessSettingsSubgroupLabel(meta.tabId, meta.subgroupId),
      valueKind: meta.valueKind,
      enumValues: meta.enumValues,
      numericBounds: meta.numericBounds,
      productDefault,
      effectiveDisplay: effectiveDisplayFor(meta.valueKind, val),
    });
  }
  rows.sort((a, b) => {
    const ta = TAB_ORDER.indexOf(a.tabId);
    const tb = TAB_ORDER.indexOf(b.tabId);
    if (ta !== tb) return ta - tb;
    if (a.subgroupId !== b.subgroupId) return a.subgroupId.localeCompare(b.subgroupId);
    return a.key.localeCompare(b.key);
  });
  return rows;
}
