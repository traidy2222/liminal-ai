import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  catalogPickerValueForManagedProvider,
  displayLabelForManagedCatalogRow,
  emptyManagedProviderFilterMessage,
  filterManagedCatalogForProvider,
  findManagedCatalogRowByModelId,
  formatManagedModelProviderBadge,
  managedModelFamilyLabel,
  managedModelFamilyRank,
  remapManagedModelIdForProvider,
  type ManagedInferenceModel,
  type ManagedProviderPreference,
} from "@liminal/core";
import { webApiFetch } from "../webApiAuth.js";
import { WEB_SERVER_BASE } from "../useSSE.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const AMBER = "var(--lim-warning, #ffb347)";
const GREEN = "var(--lim-success, #00ff88)";

const selectStyle: React.CSSProperties = {
  width: "100%",
  maxWidth: 520,
  fontSize: 12,
  padding: "8px 10px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
  background: "rgba(0,10,20,0.95)",
  color: "#dde8f0",
  fontFamily: "monospace",
};

function groupLabel(family: string): string {
  return managedModelFamilyLabel(family);
}

export interface ManagedBedrockModelsSectionProps {
  disabled?: boolean;
  mainModel: string;
  fastModel: string;
  managedProvider?: string;
  onMainModel: (modelId: string) => void;
  onFastModel: (modelId: string) => void;
  onManagedProvider?: (
    provider: ManagedProviderPreference,
    remapped: { mainModel: string; fastModel: string }
  ) => void;
  vireonConnected: boolean;
}

export function ManagedBedrockModelsSection({
  disabled = false,
  mainModel,
  fastModel,
  managedProvider = "auto",
  onMainModel,
  onFastModel,
  onManagedProvider,
  vireonConnected,
}: ManagedBedrockModelsSectionProps) {
  const [models, setModels] = useState<ManagedInferenceModel[]>([]);
  const [upstream, setUpstream] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!vireonConnected) {
      setModels([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const r = await webApiFetch(`${WEB_SERVER_BASE}/api/vireon/inference-models`);
      const j = (await r.json()) as {
        error?: string;
        models?: ManagedInferenceModel[];
        upstream?: string;
      };
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setModels(Array.isArray(j.models) ? j.models : []);
      setUpstream(j.upstream ?? "");
    } catch (e) {
      setModels([]);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [vireonConnected]);

  useEffect(() => {
    void load();
  }, [load]);

  const pref = (managedProvider === "bedrock" ||
  managedProvider === "openrouter" ||
  managedProvider === "kimchi"
    ? managedProvider
    : "auto") as ManagedProviderPreference;

  const visibleModels = useMemo(
    () => filterManagedCatalogForProvider(models, pref),
    [models, pref]
  );

  const grouped = useMemo(() => {
    const m = new Map<string, ManagedInferenceModel[]>();
    for (const row of visibleModels) {
      const key = row.family || "other";
      const list = m.get(key) ?? [];
      list.push(row);
      m.set(key, list);
    }
    return [...m.entries()].sort(([a], [b]) => {
      const dr = managedModelFamilyRank(a) - managedModelFamilyRank(b);
      if (dr !== 0) return dr;
      return a.localeCompare(b);
    });
  }, [visibleModels]);

  const mainRow = findManagedCatalogRowByModelId(visibleModels, mainModel);
  const fastRow = findManagedCatalogRowByModelId(visibleModels, fastModel);
  const mainValue = mainRow?.id ?? "";
  const fastValue = fastRow?.id ?? "";

  return (
    <div
      style={{
        marginBottom: 12,
        padding: 10,
        borderRadius: 2,
        border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
        background: "rgba(0,12,24,0.6)",
      }}
    >
      <div style={{ fontSize: 11, color: GREEN, marginBottom: 6, fontWeight: 700 }}>
        Managed models (hybrid{upstream ? ` · ${upstream}` : ""})
      </div>
      {!vireonConnected ? (
        <div style={{ fontSize: 11, color: AMBER, lineHeight: 1.45 }}>
          Sign in to Vireon to load the Bedrock catalog for your account.
        </div>
      ) : loading ? (
        <div style={{ fontSize: 11, color: CYAN }}>Loading Bedrock models…</div>
      ) : error ? (
        <div style={{ fontSize: 11, color: AMBER, lineHeight: 1.45 }}>
          {error}{" "}
          <button
            type="button"
            onClick={() => void load()}
            disabled={disabled}
            style={{
              fontSize: 10,
              color: CYAN,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            Retry
          </button>
        </div>
      ) : visibleModels.length === 0 ? (
        <div style={{ fontSize: 11, color: AMBER, lineHeight: 1.45 }}>
          {emptyManagedProviderFilterMessage(models, pref, upstream)}
        </div>
      ) : (
        <>
          {onManagedProvider ? (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "#aabbcc", marginBottom: 6 }}>managed provider</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {(["auto", "bedrock", "openrouter", "kimchi"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      const remapped = {
                        mainModel: remapManagedModelIdForProvider(mainModel, p, models),
                        fastModel: remapManagedModelIdForProvider(fastModel, p, models),
                      };
                      onManagedProvider(p, remapped);
                    }}
                    style={{
                      fontSize: 11,
                      padding: "6px 10px",
                      borderRadius: 2,
                      border: `1px solid ${pref === p ? CYAN : "rgba(var(--lim-accent-rgb),0.2)"}`,
                      background: pref === p ? "rgba(var(--lim-accent-rgb),0.12)" : "transparent",
                      color: pref === p ? CYAN : "#aabbcc",
                      cursor: disabled ? "not-allowed" : "pointer",
                    }}
                  >
                    {p === "auto"
                      ? "Auto"
                      : p === "bedrock"
                        ? "Bedrock"
                        : p === "openrouter"
                          ? "OpenRouter"
                          : "Kimchi"}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 8,
              alignItems: "center",
              marginBottom: 8,
            }}
          >
            <span style={{ fontSize: 11, color: "#aabbcc" }}>main model</span>
            <select
              key={`main-${pref}`}
              disabled={disabled}
              value={mainValue}
              onChange={(e) => {
                const row = visibleModels.find((m) => m.id === e.target.value);
                onMainModel(
                  row
                    ? catalogPickerValueForManagedProvider(row, pref)
                    : e.target.value
                );
              }}
              aria-label="Managed main model"
              style={selectStyle}
            >
              <option value="">{mainModel ? `Custom: ${mainModel}` : "Select main model…"}</option>
              {grouped.map(([family, rows]) => (
                <optgroup key={family} label={groupLabel(family)}>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {displayLabelForManagedCatalogRow(row, pref)}
                      {formatManagedModelProviderBadge(row.providers)
                        ? ` · ${formatManagedModelProviderBadge(row.providers)}`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "120px 1fr",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span style={{ fontSize: 11, color: "#aabbcc" }}>fast model</span>
            <select
              key={`fast-${pref}`}
              disabled={disabled}
              value={fastValue}
              onChange={(e) => {
                const row = visibleModels.find((m) => m.id === e.target.value);
                onFastModel(
                  row
                    ? catalogPickerValueForManagedProvider(row, pref)
                    : e.target.value
                );
              }}
              aria-label="Managed fast model"
              style={selectStyle}
            >
              <option value="">{fastModel ? `Custom: ${fastModel}` : "Select fast model…"}</option>
              {grouped.map(([family, rows]) => (
                <optgroup key={`fast-${family}`} label={groupLabel(family)}>
                  {rows.map((row) => (
                    <option key={`fast-${row.id}`} value={row.id}>
                      {displayLabelForManagedCatalogRow(row, pref)}
                      {formatManagedModelProviderBadge(row.providers)
                        ? ` · ${formatManagedModelProviderBadge(row.providers)}`
                        : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 10, color: "#6a7a8a", marginTop: 8, lineHeight: 1.45 }}>
            Hybrid chat routes through Vireon — Bedrock dotted ids and OpenRouter slugs, with failover when a
            model exists on both. Embeddings and voice may still use OpenRouter directly.
          </div>
        </>
      )}
    </div>
  );
}
