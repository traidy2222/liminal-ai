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
    const prev = m.get(f.subgroupId);
    if (prev) prev.rows.push(f);
    else m.set(f.subgroupId, { label: f.subgroupLabel, rows: [f] });
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
  width: "min(960px, 98vw)",
  height: "min(720px, 90vh)",
  maxHeight: "90vh",
  display: "flex",
  flexDirection: "column",
  background: "rgba(2,6,14,0.96)",
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  boxShadow: "0 0 40px rgba(0,0,0,0.5)",
  borderRadius: 4,
};

const btn: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  letterSpacing: "0.08em",
  padding: "10px 14px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  background: "rgba(0,20,40,0.85)",
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
  /** Pro managed inference — show Bedrock model picker instead of BYOK presets. */
  managedRoute?: boolean;
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
  managedRoute = false,
}: SettingsModalProps) {
  const [activeTabId, setActiveTabId] = useState<string>("models_api");
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!open) {
      setSearch("");
      return;
    }
    if (tabs.length && !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(tabs[0]!.id);
    }
  }, [open, tabs, activeTabId]);

  const searchQ = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!searchQ) return null;
    return fields.filter(
      (f) =>
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

  const activeRows = useMemo(() => {
    if (filtered) return filtered;
    return fields.filter((f) => f.tabId === activeTabId);
  }, [fields, activeTabId, filtered]);

  const subgroups = useMemo(() => groupBySubgroup(activeRows), [activeRows]);

  const showProvider = !!filtered || activeTabId === "models_api";
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
    "Values reflect the running server harness. API keys are never displayed. ENV = read-only field.";

  if (!open) return null;

  return (
    <div style={modal} role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
      <div style={modalInner}>
        <div
          style={{
            flexShrink: 0,
            padding: "14px 16px 10px",
            borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.12)",
          }}
        >
          <div
            id="settings-modal-title"
            style={{
              color: CYAN,
              fontWeight: 700,
              marginBottom: 8,
              fontSize: 11,
              letterSpacing: "0.12em",
              fontFamily: "monospace",
            }}
          >
            HARNESS SETTINGS
          </div>
          {hint ? (
            <div style={{ fontSize: 11, color: "#889aaa", marginBottom: 10, lineHeight: 1.5 }}>{hint}</div>
          ) : null}
          <input
            type="search"
            placeholder="Search settings…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={loading || saving}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 10px",
              fontSize: 12,
              fontFamily: "monospace",
              borderRadius: 2,
              border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
              background: "rgba(0,10,20,0.9)",
              color: "#dde8f0",
            }}
            aria-label="Search settings"
          />
        </div>

        {loading ? (
          <div style={{ padding: 16, color: AMBER, fontSize: 12, fontFamily: "monospace", flex: 1 }}>Loading…</div>
        ) : (
          <div style={{ display: "flex", flex: 1, minHeight: 0, flexDirection: "row" }}>
            {!filtered && (
              <nav
                style={{
                  width: 168,
                  flexShrink: 0,
                  borderRight: "1px solid rgba(var(--lim-accent-rgb),0.1)",
                  padding: "10px 0",
                  overflowY: "auto",
                }}
                aria-label="Settings categories"
              >
                {tabs.map((t) => {
                  const hit = tabHasMatch(t.id);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setActiveTabId(t.id)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 12px",
                        fontSize: 11,
                        fontFamily: "monospace",
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
                    fontFamily: "monospace",
                    borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.08)",
                  }}
                >
                  Search results ({filtered.length})
                </div>
              ) : null}

              <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px 8px" }}>
                {showProvider ? (
                  <div style={{ marginBottom: 16, paddingBottom: 12, borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.12)" }}>
                    <div style={{ color: AMBER, fontWeight: 700, marginBottom: 8, fontSize: 11, letterSpacing: "0.08em" }}>
                      Provider (live harness)
                    </div>
                    <div
                      style={{
                        marginBottom: 12,
                        padding: 10,
                        borderRadius: 2,
                        border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
                        background: "rgba(0,12,24,0.6)",
                      }}
                    >
                      <div style={{ fontSize: 11, color: "#aabbcc", marginBottom: 6 }}>Vireon account</div>
                      {vireonConnected ? (
                        <div style={{ fontSize: 12, fontFamily: "monospace", color: GREEN, marginBottom: 8 }}>
                          Signed in{vireonEmail ? ` as ${vireonEmail}` : ""}
                          {vireonTier ? ` (${vireonTier})` : ""} — license in ~/.liminal/
                        </div>
                      ) : (
                        <div style={{ fontSize: 11, color: AMBER, marginBottom: 8, lineHeight: 1.45 }}>
                          Not connected. Sign in for Pro license + managed inference (no AGENT_LICENSE_KEY in .env).
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
                            Sign out locally
                          </button>
                        ) : null}
                      </div>
                    </div>
                    {(teamMemoryStatus !== "not_entitled" || orgId) && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: 10,
                          borderRadius: 2,
                          border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
                          background: "rgba(0,12,24,0.6)",
                        }}
                      >
                        <div style={{ fontSize: 11, color: "#aabbcc", marginBottom: 6 }}>Team shared memory</div>
                        <div style={{ fontSize: 12, fontFamily: "monospace", color: teamMemoryStatus === "active" ? GREEN : AMBER }}>
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
                    <div style={{ fontSize: 10, color: "#778899", marginBottom: 8 }}>{providerHintText}</div>
                    {managedRoute ? (
                      <ManagedBedrockModelsSection
                        disabled={saving || loading || providerPresetLocked}
                        mainModel={providerModel}
                        fastModel={envDraft["AGENT_FAST_MODEL"] ?? ""}
                        managedProvider={envDraft["AGENT_MANAGED_PROVIDER"] ?? "auto"}
                        vireonConnected={Boolean(vireonConnected)}
                        onMainModel={(modelId) => {
                          onProviderModel(modelId);
                          onEnvChange("AGENT_MODEL", modelId);
                        }}
                        onFastModel={(modelId) => onEnvChange("AGENT_FAST_MODEL", modelId)}
                        onManagedProvider={(provider) => onEnvChange("AGENT_MANAGED_PROVIDER", provider)}
                      />
                    ) : null}
                    {!managedRoute ? (
                    <>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#aabbcc" }}>provider</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <select
                          disabled={saving || loading || providerPresetLocked}
                          value={resolvedBackendId}
                          onChange={(e) => {
                            const backendId = e.target.value;
                            const first = presetsForBackend(backendId)[0];
                            if (first) onPresetApply(first.id);
                          }}
                          aria-label="Provider backend"
                          style={{
                            width: "100%",
                            maxWidth: 520,
                            fontSize: 12,
                            padding: "8px 10px",
                            borderRadius: 2,
                            border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
                            background: "rgba(0,10,20,0.95)",
                            color: "#dde8f0",
                            fontFamily: "monospace",
                          }}
                        >
                          {PROVIDER_BACKENDS.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.label}
                            </option>
                          ))}
                        </select>
                        {backendHint ? (
                          <span style={{ fontSize: 10, color: "#8899aa", lineHeight: 1.45 }}>{backendHint}</span>
                        ) : null}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", marginBottom: 10 }}>
                      <span style={{ fontSize: 11, color: "#aabbcc" }}>model</span>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <select
                          disabled={saving || loading || providerPresetLocked}
                          value={modelDropdownValue}
                          onChange={(e) => {
                            const id = e.target.value;
                            if (id === PROVIDER_PRESET_CUSTOM_ID) return;
                            onPresetApply(id);
                          }}
                          aria-label="Provider model"
                          style={{
                            width: "100%",
                            maxWidth: 520,
                            fontSize: 12,
                            padding: "8px 10px",
                            borderRadius: 2,
                            border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
                            background: "rgba(0,10,20,0.95)",
                            color: "#dde8f0",
                            fontFamily: "monospace",
                          }}
                        >
                          {backendPresets.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.label}
                            </option>
                          ))}
                          <option value={PROVIDER_PRESET_CUSTOM_ID}>Custom…</option>
                        </select>
                        {providerPresetLocked ? (
                          <span style={{ fontSize: 10, color: MAGENTA, fontFamily: "monospace" }}>
                            Presets disabled — model or base URL is locked by process env (`.env`).
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: "#6a7a8a", lineHeight: 1.45 }}>
                            Chooses main model, base URL, fast model, and sidecar slots (
                            <code style={{ color: "#99aab8" }}>AGENT_FAST_MODEL</code>, safety judge, memory autolink/consolidate,
                            provider routing). Still click{" "}
                            <strong style={{ color: GREEN }}>SAVE TO RUNTIME PREFS</strong>. Local stacks: use any placeholder API key in{" "}
                            <code style={{ color: "#99aab8" }}>.env</code> (e.g. <code style={{ color: "#99aab8" }}>lm-studio</code>,{" "}
                            <code style={{ color: "#99aab8" }}>ollama</code>).
                          </span>
                        )}
                        {presetHint ? (
                          <span style={{ fontSize: 10, color: "#8899aa", lineHeight: 1.45 }}>{presetHint}</span>
                        ) : null}
                      </div>
                    </div>
                    </>
                    ) : null}
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", marginBottom: 6 }}>
                      <span style={{ fontSize: 11, color: "#aabbcc", display: "flex", alignItems: "center", gap: 6 }}>
                        model
                        {providerModelLocked ? (
                          <span style={{ fontSize: 9, color: MAGENTA, fontFamily: "monospace" }}>ENV</span>
                        ) : null}
                      </span>
                      <input
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          minHeight: 32,
                          fontSize: 12,
                          padding: "6px 8px",
                          borderRadius: 2,
                          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
                          background: "rgba(0,10,20,0.9)",
                          color: "#dde8f0",
                          fontFamily: "monospace",
                        }}
                        value={providerModel}
                        onChange={(e) => onProviderModel(e.target.value)}
                        disabled={saving || loading || providerModelLocked}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "#aabbcc", display: "flex", alignItems: "center", gap: 6 }}>
                        base URL
                        {providerBaseLocked ? (
                          <span style={{ fontSize: 9, color: MAGENTA, fontFamily: "monospace" }}>ENV</span>
                        ) : null}
                      </span>
                      <input
                        style={{
                          width: "100%",
                          boxSizing: "border-box",
                          minHeight: 32,
                          fontSize: 12,
                          padding: "6px 8px",
                          borderRadius: 2,
                          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
                          background: "rgba(0,10,20,0.9)",
                          color: "#dde8f0",
                          fontFamily: "monospace",
                        }}
                        value={providerBase}
                        onChange={(e) => onProviderBase(e.target.value)}
                        disabled={saving || loading || providerBaseLocked}
                      />
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "#aabbcc" }}>API key</span>
                      <div
                        style={{
                          fontSize: 12,
                          fontFamily: "monospace",
                          color: providerApiKeyConfigured ? GREEN : AMBER,
                          lineHeight: 1.4,
                        }}
                      >
                        {providerApiKeyConfigured
                          ? "Loaded (value never shown in UI)"
                          : "Not configured — set AGENT_API_KEY or OPENROUTER_API_KEY in .env"}
                      </div>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <span style={{ fontSize: 11, color: "#aabbcc" }}>inference</span>
                      <select
                        disabled={saving || loading}
                        value={envDraft["AGENT_INFERENCE_MODE"] ?? "auto"}
                        onChange={(e) => onEnvChange("AGENT_INFERENCE_MODE", e.target.value)}
                        aria-label="Inference mode"
                        style={{
                          width: "100%",
                          maxWidth: 520,
                          fontSize: 12,
                          padding: "8px 10px",
                          borderRadius: 2,
                          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
                          background: "rgba(0,10,20,0.95)",
                          color: "#dde8f0",
                          fontFamily: "monospace",
                        }}
                      >
                        <option value="auto">
                          auto — Pro uses Vireon included credits (even if .env has a key)
                        </option>
                        <option value="byok">byok — always your API key</option>
                        <option value="managed">managed — always Vireon proxy (Pro license)</option>
                      </select>
                    </div>
                  </div>
                ) : null}

                {showIntegrations ? <IntegrationsPanel agentBusy={agentBusy} /> : null}

                {!showIntegrations
                  ? subgroups.map(([subId, subLabel, subFields]) => (
                  <details
                    key={`${activeTabId}-${subId}-${searchQ || "all"}`}
                    open
                    style={{ marginBottom: 12, border: "1px solid rgba(var(--lim-accent-rgb),0.1)", borderRadius: 4 }}
                  >
                    <summary
                      style={{
                        cursor: "pointer",
                        padding: "8px 10px",
                        color: GREEN,
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: "0.06em",
                        fontFamily: "monospace",
                        listStyle: "none",
                      }}
                    >
                      {subLabel}
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
            background: "rgba(0,6,14,0.98)",
          }}
        >
          <span style={{ fontSize: 10, color: "#667788", flex: "1 1 200px" }}>
            Full reference: <code style={{ color: "#99aab8" }}>docs/configuration.md</code> (repo root)
          </span>
          <button
            type="button"
            style={{
              ...btn,
              flex: "0 1 200px",
              background: "rgba(0,30,12,0.8)",
              borderColor: "rgba(var(--lim-success-rgb),0.3)",
              color: GREEN,
            }}
            disabled={saving || loading || agentBusy}
            onClick={() => void onSave()}
          >
            {saving ? "…" : "SAVE TO RUNTIME PREFS"}
          </button>
          <button
            type="button"
            style={{ ...btn, flex: "0 1 120px" }}
            disabled={saving}
            onClick={() => {
              onClose();
            }}
          >
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsFieldRow({
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
  const sourceHelp = SOURCE_HELP[f.resolutionSource] ?? "";

  let control: React.ReactNode;
  if (f.valueKind === "boolean") {
    const on = parseBool(rawValue);
    control = (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onChange(boolToString(!on))}
          style={{
            ...btn,
            minWidth: 72,
            background: on ? "rgba(0,40,24,0.9)" : "rgba(30,8,8,0.75)",
            borderColor: on ? "rgba(var(--lim-success-rgb),0.35)" : "rgba(var(--lim-danger-rgb),0.25)",
            color: on ? GREEN : RED_ERR,
          }}
        >
          {on ? "ON" : "OFF"}
        </button>
        <span style={{ fontSize: 10, color: "#778899", fontFamily: "monospace" }}>(1 / 0)</span>
      </div>
    );
  } else if (f.valueKind === "enum" && f.enumValues?.length) {
    const ev = f.enumValues;
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
          borderRadius: 2,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.95)",
          color: "#dde8f0",
          fontFamily: "monospace",
        }}
        aria-describedby={descId}
      >
        {uniq.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
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
          borderRadius: 2,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.9)",
          color: "#dde8f0",
          fontFamily: "monospace",
        }}
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
          borderRadius: 2,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.9)",
          color: "#dde8f0",
          fontFamily: "monospace",
          resize: "vertical",
        }}
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
          borderRadius: 2,
          border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
          background: "rgba(0,10,20,0.9)",
          color: "#dde8f0",
          fontFamily: "monospace",
        }}
        aria-describedby={descId}
      />
    );
  }

  return (
    <div
      style={{
        marginBottom: 14,
        paddingBottom: 12,
        borderBottom: "1px solid rgba(var(--lim-accent-rgb),0.06)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#d0dce8" }}>{f.label}</div>
        {f.lockedByEnv ? (
          <span style={{ fontSize: 10, color: MAGENTA, fontFamily: "monospace", whiteSpace: "nowrap" }}>ENV LOCK</span>
        ) : null}
      </div>
      <div id={descId} style={{ fontSize: 11, color: "#8899aa", marginTop: 4, lineHeight: 1.45 }}>
        {f.description}
      </div>
      <code style={{ fontSize: 9, color: "#556677", display: "block", marginTop: 4 }}>{f.key}</code>
      <div style={{ marginTop: 8, display: "grid", gridTemplateColumns: "minmax(0,1fr)", gap: 6 }}>{control}</div>
      <div style={{ fontSize: 10, color: "#6a7a8a", marginTop: 8, lineHeight: 1.5, fontFamily: "monospace" }}>
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
      </div>
    </div>
  );
}
