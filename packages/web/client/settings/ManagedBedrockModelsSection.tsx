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
    default:
      return "Other";
  }
}

export interface ManagedBedrockModelsSectionProps {
  disabled?: boolean;
  mainModel: string;
  fastModel: string;
  onMainModel: (modelId: string) => void;
  onFastModel: (modelId: string) => void;
  vireonConnected: boolean;
}

export function ManagedBedrockModelsSection({
  disabled = false,
  mainModel,
  fastModel,
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
        Managed models (Bedrock{upstream ? ` · ${upstream}` : ""})
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
      ) : models.length === 0 ? (
        <div style={{ fontSize: 11, color: AMBER }}>No chat models returned from Bedrock.</div>
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
              <option value="">{mainModel ? `Custom: ${mainModel}` : "Select main model…"}</option>
              {grouped.map(([family, rows]) => (
                <optgroup key={family} label={groupLabel(family)}>
                  {rows.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
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
              <option value="">{fastModel ? `Custom: ${fastModel}` : "Select fast model…"}</option>
              {grouped.map(([family, rows]) => (
                <optgroup key={`fast-${family}`} label={groupLabel(family)}>
                  {rows.map((row) => (
                    <option key={`fast-${row.id}`} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div style={{ fontSize: 10, color: "#6a7a8a", marginTop: 8, lineHeight: 1.45 }}>
            Chat routes through Vireon → Bedrock. Embeddings and voice sidecars may still use OpenRouter in hybrid
            mode. Save runtime prefs after changing models.
          </div>
        </>
      )}
    </div>
  );
}
