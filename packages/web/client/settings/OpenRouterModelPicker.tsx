import React, { useEffect, useMemo, useState } from "react";
import type { OpenRouterCatalogModel } from "@liminal/core";
import { webApiFetch } from "../webApiAuth.js";
import { WEB_SERVER_BASE } from "../useSSE.js";

export function OpenRouterModelPicker({ value, onChange, disabled = false, singleModel = false }: {
  value: string; onChange: (id: string) => void; disabled?: boolean; singleModel?: boolean;
}) {
  const [models, setModels] = useState<OpenRouterCatalogModel[]>([]);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setLoading(true); setError("");
    webApiFetch(`${WEB_SERVER_BASE}/api/models/openrouter${refresh ? "?refresh=1" : ""}`, { signal: abort.signal })
      .then(async r => { const body = await r.json(); if (!r.ok) throw Error(body.error || "Models could not be loaded."); return body.models; })
      .then(rows => { if (!Array.isArray(rows)) throw Error("Invalid model catalog."); if (!abort.signal.aborted) { setModels(rows); setPage(0); } })
      .catch(e => { if (!abort.signal.aborted) setError(e.message); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [refresh]);
  const filtered = useMemo(() => models.filter(m => `${m.name} ${m.id}`.toLowerCase().includes(query.toLowerCase().trim())), [models, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / 40));
  const current = models.find(m => m.id === value);
  return <div className="model-catalog">
    <div className="model-catalog-heading"><div><strong>OpenRouter model</strong><small>{loading ? "Loading catalog…" : `${models.length} models · individual models, no bundles`}</small></div>
      <button type="button" disabled={loading || disabled} onClick={() => setRefresh(n => n + 1)}>Refresh</button></div>
    <div className="model-current"><small>Selected model</small><strong>{current?.name || value || "Choose a model"}</strong><code>{value}</code></div>
    <input type="search" aria-label="Search OpenRouter models" placeholder="Search by model name or ID…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} />
    {error ? <p role="alert">{error} Your selection has not changed. Use Refresh to retry.</p> : null}
    <div className="model-results" aria-label="OpenRouter models" aria-busy={loading}>
      {filtered.slice(page * 40, (page + 1) * 40).map(m => <button type="button" key={m.id} className={value === m.id ? "is-selected" : ""}
        aria-pressed={value === m.id} disabled={disabled || (singleModel && m.isRouter)} onClick={() => onChange(m.id)}>
        <span><strong>{m.name}</strong><code>{m.id}</code></span>
        <small>{m.contextLength ? `${Math.round(m.contextLength / 1000)}k context · ` : ""}{m.supportsTools ? "Tools" : "No tool support"}{m.inputModalities.includes("image") ? " · Vision" : ""}{m.isRouter ? " · Routes across models" : ""}</small>
      </button>)}
      {!loading && !error && filtered.length === 0 ? <p>No models match your search.</p> : null}
    </div>
    {pages > 1 ? <div className="model-pagination"><button type="button" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</button><span>{page + 1} / {pages} · {filtered.length} results</span><button type="button" disabled={page + 1 >= pages} onClick={() => setPage(p => p + 1)}>Next</button></div> : null}
    {current && !current.supportsTools ? <p>This model does not advertise tool calling. Agent actions may be unavailable.</p> : null}
    {singleModel && current && !current.inputModalities.includes("image") ? <p>This model is text-only. Vision requests will not switch to another model.</p> : null}
  </div>;
}
