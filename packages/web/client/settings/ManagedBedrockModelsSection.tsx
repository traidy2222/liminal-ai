import React, { useCallback, useEffect, useMemo, useState } from "react";
import type { ManagedInferenceModel } from "@liminal/core";
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

const MANAGED_PROVIDER_OPTIONS = [
  { value: "auto", label: "auto — shape-based routing + cross-provider failover" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "kimchi", label: "Cast AI (Kimchi)" },
] as const;

function groupLabel(family: string): string {
  switch (family) {
    case "anthropic":
      return "Anthropic";
    case "amazon":
      return "Amazon";
    case "meta":
      return "Meta";
    case "mistral":
      return "Mistral";
    case "openai":
      return "OpenAI";
    case "cohere":
      return "Cohere";
    case "deepseek":
      return "DeepSeek";
    case "qwen":
      return "Qwen";
    case "google":
      return "Google";
    case "nvidia":
      return "NVIDIA";
    case "zai":
      return "Z.AI";
    default:
      return family.charAt(0).toUpperCase() + family.slice(1) || "Other";
  }
}

function providerBadge(model: ManagedInferenceModel): string {
  const ps = model.providers?.map((p) => p.provider) ?? [];
  if (ps.length > 1) return ps.join(" + ");
  if (ps.length === 1) return ps[0]!;
  return "";
}

function optionLabel(model: ManagedInferenceModel): string {
  const badge = providerBadge(model);
  const base = model.label && model.label !== model.id ? model.label : model.id;
  return badge ? `${base} · ${badge}` : base;
}

export interface ManagedBedrockModelsSectionProps {
  disabled?: boolean;
  mainModel: string;
  fastModel: string;
  managedProvider: string;
  onManagedProvider: (value: string) => void;
  onMainModel: (modelId: string) => void;
  onFastModel: (modelId: string) => void;
  vireonConnected: boolean;
}

export function ManagedBedrockModelsSection({
  disabled = false,
  mainModel,
  fastModel,
  managedProvider,
  onManagedProvider,
  onMainModel,
  onFastModel,
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

  const grouped = useMemo(() => {
    const m = new Map<string, ManagedInferenceModel[]>();
    for (const row of models) {
      const key = row.family || "other";
      const list = m.get(key) ?? [];
      list.push(row);
      m.set(key, list);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [models]);

  const mainValue = models.some((m) => m.id === mainModel) ? mainModel : "";
  const fastValue = models.some((m) => m.id === fastModel) ? fastModel : "";
  const upstreamLabel =
    upstream === "hybrid" ? "hybrid (Bedrock + OpenRouter + Kimchi)" : upstream || "managed";

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
        Managed inference (Vireon · {upstreamLabel})
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "120px 1fr",
          gap: 8,
          alignItems: "center",
          marginBottom: 10,
        }}
      >
        <span style={{ fontSize: 11, color: "#aabbcc" }}>upstream</span>
        <select
          disabled={disabled}
          value={managedProvider || "auto"}
          onChange={(e) => onManagedProvider(e.target.value)}
          aria-label="Managed upstream provider"
          style={selectStyle}
        >
          {MANAGED_PROVIDER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {!vireonConnected ? (
        <div style={{ fontSize: 11, color: AMBER, lineHeight: 1.45 }}>
          Sign in to Vireon to load the managed model catalog.
        </div>
      ) : loading ? (
        <div style={{ fontSize: 11, color: CYAN }}>Loading managed models…</div>
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
      ) : models.length === 0 ? (
        <div style={{ fontSize: 11, color: AMBER }}>No models returned from managed inference.</div>
      ) : (
        <>
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
              disabled={disabled}
              value={mainValue}
              onChange={(e) => onMainModel(e.target.value)}
              aria-label="Managed main model"
              style={selectStyle}
            >
              <option value="">
                {mainModel ? `Current: ${mainModel}` : "Select main model…"}
              </option>
              {grouped.map(([family, rows]) => (
                <optgroup key={family} label={groupLabel(family)}>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {optionLabel(row)}
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
              disabled={disabled}
              value={fastValue}
              onChange={(e) => onFastModel(e.target.value)}
              aria-label="Managed fast model"
              style={selectStyle}
            >
              <option value="">
                {fastModel ? `Current: ${fastModel}` : "Select fast model…"}
              </option>
              {grouped.map(([family, rows]) => (
                <optgroup key={`fast-${family}`} label={groupLabel(family)}>
                  {rows.map((row) => (
                    <option key={`fast-${row.id}`} value={row.id}>
                      {optionLabel(row)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 10, color: "#6a7a8a", marginTop: 8, lineHeight: 1.45 }}>
            {models.length} models in catalog. Dual-provider entries show which upstreams can serve
            them. Save runtime prefs after changes. Set inference mode to <strong>byok</strong> below
            to use your own API key instead.
          </div>
        </>
      )}
    </div>
  );
}
