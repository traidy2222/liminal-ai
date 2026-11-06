import { isMultiModelRouter } from "@liminal/core/model-policy";
import { OpenRouterModelPicker } from "./OpenRouterModelPicker.js";
import { CacheUsagePanel } from "./CacheUsagePanel.js";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { HarnessSettingsApiField } from "@liminal/core";
import {
  PROVIDER_BACKENDS,
  PROVIDER_PRESETS,
  PROVIDER_PRESET_CUSTOM_ID,
  presetsForBackend,
  resolveBackendSelection,
  resolvePresetSelection,
} from "./providerPresets.js";
import { everydaySettings, settingsCategories, settingsCategory } from "./settingsPresentation.js";
import { IntegrationsPanel } from "./IntegrationsPanel.js";
import { ManagedBedrockModelsSection } from "./ManagedBedrockModelsSection.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const AMBER = "var(--lim-warn, #ffb347)";
const MAGENTA = "var(--lim-secondary, #ff4488)";
const GREEN = "var(--lim-success, #00ff88)";
const RED_ERR = "var(--lim-danger, #ff2244)";

export interface SettingsTabMeta {
  id: string;
  title: string;
}

const SOURCE_HELP: Record<string, string> = {
  environment: "Value comes from the process environment and overrides saved preferences.",
  runtime_preferences: "Value is stored in the runtime preferences slice (not harness env).",
  harness_preferences: "Value is saved in harness settings (runtime prefs file).",
  product_default: "No explicit save; the product default applies until you change it.",
  unset: "Nothing is set and there is no built-in default for this key.",
};

function resolutionLabel(source: string): string {
  switch (source) {
    case "environment":
      return "Source: environment (locked)";
    case "runtime_preferences":
      return "Source: runtime preferences";
    case "harness_preferences":
      return "Source: saved harness settings";
    case "product_default":
      return "Source: product default";
    case "unset":
      return "Source: unset";
    default:
      return `Source: ${source}`;
  }
}

function groupBySubgroup(rows: HarnessSettingsApiField[]): [string, string, HarnessSettingsApiField[]][] {
  const m = new Map<string, { label: string; rows: HarnessSettingsApiField[] }>();
  for (const f of rows) {
    const group = f.key === "AGENT_EFFORT" || f.key === "AGENT_TTS_ENABLED" || f.key === "AGENT_TTS_MODEL" ? "Response & voice" : f.subgroupLabel;
    const prev = m.get(group);
    if (prev) prev.rows.push(f);
    else m.set(group, { label: group, rows: [f] });
  }
  return [...m.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([subgroupId, { label, rows: r }]) => [subgroupId, label, r] as [string, string, HarnessSettingsApiField[]]);
}

function boolToString(on: boolean): string {
  return on ? "1" : "0";
}

function parseBool(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  return t === "1" || t === "on" || t === "yes" || t === "true";
}

const modal: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 120,
  background: "rgba(0,4,10,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "12px",
};

const modalInner: React.CSSProperties = {
  width: "min(1120px, 98vw)",
  height: "min(840px, 94vh)",
  maxHeight: "94vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--lim-surface)",
  border: "1px solid rgba(190,195,218,0.18)",
  boxShadow: "0 24px 100px rgba(0,0,0,0.4)",
  borderRadius: 18,
  overflow: "hidden",
};

const btn: React.CSSProperties = {
  fontFamily: "var(--lim-font-body, system-ui)",
  fontSize: 13,
  letterSpacing: "0",
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  background: "var(--lim-surface)",
  color: CYAN,
  cursor: "pointer",
};

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  hint: string;
  loading: boolean;
  error: string | null;
  saving: boolean;
  agentBusy: boolean;
  tabs: SettingsTabMeta[];
  fields: HarnessSettingsApiField[];
  providerModel: string;
  providerBase: string;
  /** When set, `AGENT_MODEL` is non-empty in process.env (e.g. `.env`) and cannot be overridden from this UI. */
  providerModelLocked?: boolean;
  /** When set, `AGENT_API_BASE_URL` is set in process.env and cannot be overridden from this UI. */
  providerBaseLocked?: boolean;
  /** Whether the server has a provider API key loaded (secret is never sent). */
  providerApiKeyConfigured?: boolean;
  /** Fill model, base URL, and fast-model harness env from a preset (no-op for Custom). */
  onPresetApply: (presetId: string) => void;
  /** Fill managed Bedrock main + fast from a Bedrock preset pack. */
  onBedrockPresetApply: (presetId: string) => void;
  onProviderModel: (v: string) => void;
  onProviderBase: (v: string) => void;
  envDraft: Record<string, string>;
  onEnvChange: (key: string, v: string) => void;
  onSave: () => void;
  vireonConnected?: boolean;
  vireonEmail?: string | null;
  vireonTier?: string | null;
  onVireonSignIn?: () => void;
  onVireonSignOut?: () => void;
  vireonBusy?: boolean;
  teamMemoryStatus?: "active" | "offline" | "not_entitled";
  orgId?: string | null;
  /** Show Vireon managed model catalog (inference mode is not byok). */
  showManagedModels?: boolean;
  /** Show BYOK backend/preset pickers (inference mode is not managed-only). */
  showByokPresets?: boolean;
}

export function SettingsModal({
  open,
  onClose,
  hint,
  loading,
  error,
  saving,
  agentBusy,
  tabs,
  fields,
  providerModel,
  providerBase,
  providerModelLocked = false,
  providerBaseLocked = false,
  providerApiKeyConfigured = false,
  onPresetApply,
  onBedrockPresetApply,
  onProviderModel,
  onProviderBase,
  envDraft,
  onEnvChange,
  onSave,
  vireonConnected = false,
  vireonEmail = null,
  vireonTier = null,
  onVireonSignIn,
  onVireonSignOut,
  vireonBusy = false,
  teamMemoryStatus = "not_entitled",
  orgId = null,
  showManagedModels = false,
  showByokPresets = true,
}: SettingsModalProps) {
  const [activeTabId, setActiveTabId] = useState<string>("models_api");
  const [search, setSearch] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const navigation = [...settingsCategories, { id: "account", title: "Account" }, { id: "integrations", title: "Connected tools" }];

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    if (!navigation.some((t) => t.id === activeTabId)) setActiveTabId("models_api");
  }, [open, tabs, activeTabId]);

  const searchQ = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!searchQ) return null;
    return fields.filter(
      (f) =>
        (everydaySettings[f.key]?.label.toLowerCase().includes(searchQ) ?? false) ||
        f.label.toLowerCase().includes(searchQ) ||
        f.key.toLowerCase().includes(searchQ) ||
        f.description.toLowerCase().includes(searchQ) ||
        f.subgroupLabel.toLowerCase().includes(searchQ)
    );
  }, [fields, searchQ]);

  const tabHasMatch = useCallback(
    (tabId: string) => {
      if (!searchQ) return false;
      return fields.some(
        (f) =>
          f.tabId === tabId &&
          (f.label.toLowerCase().includes(searchQ) ||
            f.key.toLowerCase().includes(searchQ) ||
            f.description.toLowerCase().includes(searchQ) ||
            f.subgroupLabel.toLowerCase().includes(searchQ))
      );
    },
    [fields, searchQ]
  );

  const categoryRows = fields.filter((f) => settingsCategory(f.tabId, f.key) === activeTabId && !["AGENT_INFERENCE_MODE", "AGENT_MANAGED_PROVIDER"].includes(f.key));
  const singleModel = parseBool(envDraft["AGENT_SINGLE_MODEL"] ?? "0");
  const activeRows = (filtered ?? categoryRows.filter((f) => advanced || activeTabId === "advanced" || everydaySettings[f.key])).filter(f =>
    f.key !== "AGENT_SINGLE_MODEL" && !(singleModel && f.key !== "AGENT_MODEL" && f.key.endsWith("_MODEL")));

  const hiddenCount = categoryRows.length - activeRows.length;
  const subgroups = groupBySubgroup(activeRows);
  const showProvider = !filtered && activeTabId === "models_api";
  const showIntegrations = activeTabId === "integrations" && !filtered;
  const providerPresetLocked = providerModelLocked || providerBaseLocked;
  const resolvedBackendId = useMemo(
    () => resolveBackendSelection(providerBase),
    [providerBase]
  );
  const backendPresets = useMemo(
    () => presetsForBackend(resolvedBackendId),
    [resolvedBackendId]
  );
  const resolvedPresetId = useMemo(
    () => resolvePresetSelection(providerModel, providerBase),
    [providerModel, providerBase]
  );
  const modelDropdownValue = backendPresets.some((p) => p.id === resolvedPresetId)
    ? resolvedPresetId
    : PROVIDER_PRESET_CUSTOM_ID;
  const presetHint = useMemo(() => {
    const p = PROVIDER_PRESETS.find((x) => x.id === resolvedPresetId);
    return p?.hint ?? "";
  }, [resolvedPresetId]);
  const backendHint = useMemo(() => {
    const b = PROVIDER_BACKENDS.find((x) => x.id === resolvedBackendId);
    return b?.hint ?? "";
  }, [resolvedBackendId]);

  const providerHintText =
    "Choose how Liminal connects to a model. Keys stay on your server.";

  if (!open) return null;

  return (
    <div style={modal} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div style={modalInner} className="lim-settings-panel">
        <div
          style={{
            flexShrink: 0,
            padding: "24px 24px 18px",
            borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.12)",
          }}
        >
          <div
            id="settings-modal-title"
            style={{
              color: "var(--lim-text)",
              fontWeight: 500,
              marginBottom: 12,
              fontSize: 28,
              letterSpacing: "-0.8px",
              fontFamily: "'Liminal Display', var(--lim-font-body)",
            }}
          >
            Settings
          </div>
          <div className="settings-intro">Make Liminal work the way you do. Advanced controls are tucked away until you need them.</div>
          <input
            type="search"
            placeholder="Search all settings, including advanced…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading || saving}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "var(--lim-font-body)",
              borderRadius: 10,
              border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
              background: "rgba(0,10,20,0.9)",
              color: "#dde8f0",
            }}
            aria-label="Search settings"
          />
        </div>

        {loading ? (
          <div style={{ padding: 16, color: AMBER, fontSize: 12, fontFamily: "var(--lim-font-body)", flex: 1 }}>Loading…</div>
        ) : (
          <div className="lim-settings-body" style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "row" }}>
            {!filtered && (
              <nav
                style={{
                  width: 190,
                  flexShrink: 0,
                  borderRight: "1px solid rgba(var(--lim-accent-rgb),0.1)",
                  padding: "14px 8px",
                  overflowY: "auto",
                }}
                aria-label="Settings categories"
              >
                {navigation.map((t) => {
                  const hit = tabHasMatch(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => { setActiveTabId(t.id); setAdvanced(false); }}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "11px 14px",
                        fontSize: 13,
                        fontFamily: "var(--lim-font-body)",
                        borderRadius: 7,
                        border: "none",
                        borderLeft:
                          activeTabId === t.id ? `3px solid ${CYAN}` : "3px solid transparent",
                        background: activeTabId === t.id ? "rgba(var(--lim-accent-rgb),0.08)" : "transparent",
                        color: activeTabId === t.id ? CYAN : "#aab8c4",
                        cursor: "pointer",
                      }}
                    >
                      {t.title}
                      {hit ? <span style={{ color: AMBER, marginLeft: 4 }}>·</span> : null}
                    </button>
                  );
                })}
              </nav>
            )}

            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
              {filtered ? (
                <div
                  style={{
                    padding: "8px 14px",
                    fontSize: 11,
                    color: AMBER,
                    fontFamily: "var(--lim-font-body)",
                    borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.08)",
                  }}
                >
                  Search results ({filtered.length})
                </div>
              ) : null}

              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 8px" }}>
                {activeTabId === "account" && !filtered ? (<div className="settings-account">                    <div
                      style={{
                        marginBottom: 12,
                        padding: 10,
                        borderRadius: 10,
                        border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
                        background: "var(--lim-bg)",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#aabbcc", marginBottom: 6 }}>Vireon account</div>
                      {vireonConnected ? (
                        <div style={{ fontSize: 12, fontFamily: "var(--lim-font-body)", color: GREEN, marginBottom: 8 }}>
                          Signed in{vireonEmail ? ` as ${vireonEmail}` : ""}
                          {vireonTier ? ` (${vireonTier})` : ""} — license in ~/.liminal/
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: AMBER, marginBottom: 8, lineHeight: 1.45 }}>
                          Sign in to use your Vireon plan. Local workspaces do not require an account.
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {onVireonSignIn ? (
                          <button
                            type="button"
                            style={{ ...btn, padding: "6px 10px", fontSize: 10 }}
                            disabled={saving || loading || vireonBusy}
                            onClick={onVireonSignIn}
                          >
                            {vireonBusy ? "Opening browser…" : "Sign in to Vireon"}
                          </button>
                        ) : null}
                        {vireonConnected && onVireonSignOut ? (
                          <button
                            type="button"
                            style={{ ...btn, padding: "6px 10px", fontSize: 10, color: MAGENTA }}
                            disabled={saving || loading || vireonBusy}
                            onClick={onVireonSignOut}
                          >
                            Sign out
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {(teamMemoryStatus !== "not_entitled" || orgId) && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: 10,
                          borderRadius: 10,
                          border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
                          background: "var(--lim-bg)",
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#aabbcc", marginBottom: 6 }}>Team shared memory</div>
                        <div style={{ fontSize: 12, fontFamily: "var(--lim-font-body)", color: teamMemoryStatus === "active" ? GREEN : AMBER }}>
                          {teamMemoryStatus === "active"
                            ? "Active — org notes sync each turn (EE + AGENT_TEAM_MEMORY_SYNC)"
                            : teamMemoryStatus === "offline"
                              ? "Offline — entitled but org not bound or sync disabled"
                              : "Not entitled — Team tier required"}
                        </div>
                        {orgId ? (
                          <div style={{ fontSize: 10, color: "#778899", marginTop: 6 }}>
                            Org: <span style={{ fontFamily: "monospace" }}>{orgId}</span>
                          </div>
                        ) : (
                          <div style={{ fontSize: 10, color: AMBER, marginTop: 6 }}>
                            No org on license — complete Team checkout or re-login.
                          </div>
                        )}
                      </div>
                    )}
</div>) : null}
                {showProvider && <CacheUsagePanel />}
                {showProvider ? (
                  <section className="settings-provider">
                    <h2>Model & provider</h2>
                    <p>Choose how Liminal connects to a model.</p>
                    <label className="settings-control"><span>Connection</span>
                      <select aria-label="Inference mode" disabled={saving || loading}
                        value={envDraft["AGENT_INFERENCE_MODE"] ?? "auto"} onChange={(e) => onEnvChange("AGENT_INFERENCE_MODE", e.target.value)}>
                        <option value="auto">Automatic</option><option value="byok">Use my own API key</option><option value="managed">Use Vireon credits</option>
                      </select>
                    </label>
                    {showManagedModels ? <ManagedBedrockModelsSection singleModel={singleModel}
                      disabled={saving || loading || providerPresetLocked} mainModel={providerModel}
                      fastModel={envDraft["AGENT_FAST_MODEL"] ?? ""} managedProvider={envDraft["AGENT_MANAGED_PROVIDER"] ?? "auto"}
                      onManagedProvider={(v) => onEnvChange("AGENT_MANAGED_PROVIDER", v)}
                      vireonConnected={Boolean(vireonConnected)}
                      onMainModel={(v) => { onProviderModel(v); onEnvChange("AGENT_MODEL", v); }} onFastModel={(v) => onEnvChange("AGENT_FAST_MODEL", v)}
                      onBedrockPresetApply={onBedrockPresetApply} /> : null}
                    {showByokPresets ? <>
                      <label className="settings-control"><span>Provider</span><select aria-label="Provider" value={resolvedBackendId} disabled={providerPresetLocked || saving || loading}
                        onChange={(e) => { const backend = PROVIDER_BACKENDS.find(b => b.id === e.target.value); if (backend) onProviderBase(backend.baseURL); }}>
                        {PROVIDER_BACKENDS.map((backend) => <option key={backend.id} value={backend.id}>{backend.label}</option>)}
                      </select></label>
                      {resolvedBackendId === "openrouter" ? <OpenRouterModelPicker value={providerModel} singleModel={singleModel}
                        disabled={providerModelLocked || saving || loading} onChange={v => { onProviderModel(v); onEnvChange("AGENT_MODEL", v); }} /> : <>
                      {!singleModel && <label className="settings-control"><span>Model preset</span><select aria-label="Model preset" value={modelDropdownValue} disabled={providerPresetLocked || saving || loading}
                        onChange={(e) => { if (e.target.value !== PROVIDER_PRESET_CUSTOM_ID) onPresetApply(e.target.value); }}>
                        {backendPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
                        {!backendPresets.some((p) => p.id === PROVIDER_PRESET_CUSTOM_ID) ? <option value={PROVIDER_PRESET_CUSTOM_ID}>Custom model</option> : null}
                      </select></label>}
                      <label className="settings-control"><span>Model ID {providerModelLocked ? '· managed in environment' : ''}</span>
                        <input aria-label="Model ID" value={providerModel} disabled={providerModelLocked || saving || loading} onChange={(e) => onProviderModel(e.target.value)} />
                      </label>
                      </>}
                      <details className="settings-connection-details"><summary>Connection details</summary>
                        <label className="settings-control"><span>Server address {providerBaseLocked ? '· managed in environment' : ''}</span>
                          <input aria-label="Server address" value={providerBase} disabled={providerBaseLocked || saving || loading} onChange={(e) => onProviderBase(e.target.value)} />
                        </label>
                        <p>{backendHint}</p>{!singleModel && resolvedBackendId !== "openrouter" && presetHint ? <p>{presetHint}</p> : null}
                      </details>
                      <div className="settings-key-status">{providerApiKeyConfigured ? '✓ API key configured' : 'Add your API key to the server’s .env file to connect.'}</div>
                    </> : null}
                    <label className="model-single-toggle"><input type="checkbox" aria-label="Use one model for everything" checked={singleModel}
                      disabled={saving || loading || fields.some(f => f.key === "AGENT_SINGLE_MODEL" && f.lockedByEnv)}
                      onChange={e => onEnvChange("AGENT_SINGLE_MODEL", e.target.checked ? "1" : "0")} />
                      <span><strong>Use one model for everything</strong><small>Chat, background work, and vision use the selected model. Separate embeddings, speech models, and automatic model fallbacks are off. Your previous choices are kept.</small></span>
                    </label>
                    {singleModel && isMultiModelRouter(providerModel) ? <p role="alert">Choose a specific model. Routers cannot guarantee a single model.</p> : null}
                  </section>
                ) : null}

                {showIntegrations ? <IntegrationsPanel agentBusy={agentBusy} /> : null}

                {!filtered && !["advanced", "account", "integrations"].includes(activeTabId) && (hiddenCount > 0 || advanced) ? (
                  <label className="settings-advanced-toggle"><input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                    Show advanced options <small>{advanced ? "All options in this category" : `${hiddenCount} more options`}</small>
                  </label>
                ) : null}
                {filtered && filtered.length === 0 ? <p className="settings-empty">No matching settings. Try another name or keyword.</p> : null}
                {!showIntegrations && (activeTabId !== "account" || !!filtered)
                  ? subgroups.map(([subId, subLabel, subFields]) => (
                  <details
                    className="settings-group"
                    key={`${activeTabId}-${subId}-${searchQ || "all"}`}
                    open={!!filtered || activeTabId !== "advanced"}
                    style={{ marginBottom: 12, border: "1px solid rgba(var(--lim-accent-rgb),0.1)", borderRadius: 4 }}
                  >
                    <summary
                      style={{
                        cursor: "pointer",
                        padding: "8px 10px",
                        color: "var(--lim-text)",
                        fontWeight: 500,
                        fontSize: 14,
                        letterSpacing: "0",
                        fontFamily: "var(--lim-font-body)",
                        listStyle: "none",
                      }}
                    >
                      {subLabel}<span className="settings-group-count">{subFields.length} options</span>
                    </summary>
                    <div style={{ padding: "4px 10px 12px" }}>
                      {subFields.map((f) => (
                        <SettingsFieldRow
                          key={f.key}
                          field={f}
                          rawValue={f.lockedByEnv ? f.value : envDraft[f.key] ?? f.value}
                          disabled={f.lockedByEnv || saving || loading}
                          onChange={(v) => onEnvChange(f.key, v)}
                        />
                      ))}
                    </div>
                  </details>
                ))
                  : null}
              </div>
            </div>
          </div>
        )}

        {error ? (
          <div style={{ padding: "0 16px", color: RED_ERR, fontSize: 12, fontFamily: "monospace" }}>{error}</div>
        ) : null}

        <div
          style={{
            flexShrink: 0,
            padding: "12px 16px",
            borderTop: "1px solid rgba(var(--lim-accent-rgb),0.12)",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            background: "var(--lim-surface)",
          }}
        >
          <span className="lim-settings-note" style={{ fontSize: 12, color: "var(--lim-text-muted)", flex: "1 1 160px" }}>
            {agentBusy ? "You can save when the current task finishes." : "Changes apply when you save."}
          </span>
          <button
            type="button"
            style={{
              ...btn,
              flex: "0 1 160px",
              background: CYAN,
              borderColor: "transparent",
              color: "var(--lim-on-accent, #191c27)",
            }}
            disabled={saving || loading || agentBusy || (singleModel && isMultiModelRouter(providerModel))}
            onClick={() => void onSave()}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            style={{ ...btn, flex: "0 1 120px" }}
            disabled={saving}
            onClick={() => {
              onClose();
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function SettingsFieldRow({
  field: f,
  rawValue,
  disabled,
  onChange,
}: {
  field: HarnessSettingsApiField;
  rawValue: string;
  disabled: boolean;
  onChange: (v: string) => void;
}) {
  const descId = `desc-${f.key}`;
  const presentation = everydaySettings[f.key];
  const sourceHelp = SOURCE_HELP[f.resolutionSource] ?? "";

  const kind = f.key === "AGENT_TTS_ENABLED" ? "boolean" : f.key === "AGENT_EFFORT" ? "enum" : f.valueKind;
  const enumValues = f.key === "AGENT_EFFORT" ? ["low", "medium", "high", "xhigh"] : f.enumValues;
  let control: React.ReactNode;
  if (kind === "boolean") {
    const on = parseBool(rawValue);
    control = (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={presentation?.label ?? f.label}
          disabled={disabled}
          onClick={() => onChange(boolToString(!on))}
          style={{
            ...btn,
            minWidth: 72,
            background: on ? "rgba(var(--lim-accent-rgb),.12)" : "var(--lim-bg)",
            borderColor: on ? "var(--lim-accent)" : "var(--lim-border)",
            color: on ? CYAN : "var(--lim-text-muted)",
          }}
        >
          {on ? "On" : "Off"}
        </button>

      </div>
    );
  } else if (kind === "enum" && enumValues?.length) {
    const ev = enumValues;
    const inList = ev.includes(rawValue);
    const opts = inList ? [...ev] : [rawValue, ...ev];
    const uniq = [...new Set(opts)];
    control = (
      <select
        disabled={disabled}
        value={rawValue}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          maxWidth: 420,
          fontSize: 12,
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.95)",
          color: "#dde8f0",
          fontFamily: "var(--lim-font-body)",
        }}
        aria-label={presentation?.label ?? f.label}
        aria-describedby={descId}
      >
        {uniq.map((opt) => (
          <option key={opt} value={opt}>
            {f.key === "AGENT_TRANSCRIBE_MODEL" ? ({ "local/whisper-large-v3-turbo": "Whisper — Fast · local", "local/qwen3-asr-1.7b": "Qwen — Accuracy · local" }[opt] ?? opt) : opt}
            {!ev.includes(opt) ? " (non-standard)" : ""}
          </option>
        ))}
      </select>
    );
  } else if (f.valueKind === "number") {
    control = (
      <input
        type="number"
        disabled={disabled}
        value={rawValue}
        placeholder={rawValue ? undefined : f.productDefault ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        min={f.numericBounds?.min}
        max={f.numericBounds?.max}
        step={f.numericBounds?.step ?? 1}
        style={{
          width: "100%",
          maxWidth: 420,
          fontSize: 12,
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.9)",
          color: "#dde8f0",
          fontFamily: "var(--lim-font-body)",
        }}
        aria-label={presentation?.label ?? f.label}
        aria-describedby={descId}
      />
    );
  } else {
    const long = f.key.includes("COMMAND") || f.key.includes("USER_AGENT") || f.key.includes("TEMPLATE");
    control = long ? (
      <textarea
        disabled={disabled}
        value={rawValue}
        placeholder={rawValue ? undefined : f.productDefault ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontSize: 11,
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.9)",
          color: "#dde8f0",
          fontFamily: "var(--lim-font-body)",
          resize: "vertical",
        }}
        aria-label={presentation?.label ?? f.label}
        aria-describedby={descId}
      />
    ) : (
      <input
        type="text"
        disabled={disabled}
        value={rawValue}
        placeholder={rawValue ? undefined : f.productDefault ?? undefined}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          boxSizing: "border-box",
          fontSize: 11,
          padding: "6px 8px",
          borderRadius: 10,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.9)",
          color: "#dde8f0",
          fontFamily: "var(--lim-font-body)",
        }}
        aria-label={presentation?.label ?? f.label}
        aria-describedby={descId}
      />
    );
  }

  return (
    <div className="settings-field"
      style={{
        marginBottom: 14,
        paddingBottom: 12,
        borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#d0dce8" }}>{presentation?.label ?? f.label}</div>
        {f.lockedByEnv ? (
          <span style={{ fontSize: 10, color: MAGENTA, fontFamily: "var(--lim-font-body)", whiteSpace: "nowrap" }}>Managed in environment</span>
        ) : null}
      </div>
      <div id={descId} style={{ fontSize: 11, color: "#8899aa", marginTop: 4, lineHeight: 1.45 }}>
        {presentation?.description ?? f.description}
      </div>

      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 6 }}>{control}</div>
      {f.key === "AGENT_TTS_MODEL" && <div style={{ marginTop: 8 }}>
        <button type="button" style={btn} disabled={disabled || rawValue === "local/jarvis-warm"}
          onClick={() => onChange("local/jarvis-warm")}>
          {rawValue === "local/jarvis-warm" ? "JARVIS Warm selected" : "Use JARVIS Warm — local"}
        </button>
        <p style={{ fontSize: 12, color: "var(--lim-text-muted)" }}>
          Install once with <code>liminal voice install</code> (about 3 GB of models). No speech API key required.
        </p>
      </div>}
      <details className="settings-technical"><summary>Technical details</summary><code>{f.key}</code>
        {f.key === "AGENT_TRANSCRIBE_MODEL" && <label style={{ display: "grid", gap: 6, marginTop: 8 }}>
          Custom provider model
          <input aria-label="Custom transcription model" type="text" value={rawValue} disabled={disabled}
            onChange={event => onChange(event.target.value)} placeholder="openai/whisper-large-v3-turbo" />
          <small>Cloud models use your configured provider.</small>
        </label>}
      <div style={{ fontSize: 11, color: "var(--lim-text-muted)", marginTop: 8, lineHeight: 1.5 }}>
        <div>
          Effective: <span style={{ color: "#aabccc" }}>{f.effectiveDisplay}</span>
          {f.resolutionSource === "unset" && rawValue === "" ? (
            <span style={{ color: AMBER }}> — empty</span>
          ) : null}
        </div>
        <div title={sourceHelp}>{resolutionLabel(f.resolutionSource)}</div>
        <div>
          Product default:{" "}
          {f.productDefault != null ? (
            <span style={{ color: "#aabccc" }}>
              {f.productDefault === "" ? "(empty — inherit / auto)" : f.productDefault}
            </span>
          ) : (
            <span style={{ color: AMBER }}>none</span>
          )}
        </div>
      </div></details>
    </div>
  );
}
