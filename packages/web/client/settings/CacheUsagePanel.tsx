import React, { useEffect, useState } from "react";
import { webApiFetch } from "../webApiAuth.js";

export function CacheUsagePanel() {
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const refresh = async () => {
    setLoading(true); setError("");
    try { const response = await webApiFetch("/api/cache/stats"); if (!response.ok) throw Error(); setStats(await response.json()); }
    catch { setError("Cache statistics unavailable"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  const percent = (value: unknown) => typeof value === "number" ? `${(value * 100).toFixed(1)}%` : "Not reported";
  const agent = stats?.agent;
  return <section style={{ padding: 16, border: "1px solid var(--lim-border)", borderRadius: 12, marginBottom: 16 }}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><strong>Prompt cache</strong><button disabled={loading} onClick={() => void refresh()}>Refresh</button></div>
    {error ? <p>{error}</p> : !agent?.requests ? <p>No measured responses yet. Statistics appear as you use Liminal.</p> : <>
      <p>{percent(agent.cacheHitRate)} cached-token share where usage is known<br />{agent.cachedTokens.toLocaleString()} cached / {agent.inputTokens.toLocaleString()} covered input tokens · {agent.requests} measured responses</p>
      <p>Last 50: {percent(stats.last50.cacheHitRate)} tokens cached · {percent(stats.last50.requestHitRate)} requests with a hit<br />Cache data covers {percent(agent.coverage)} of responses and {percent(agent.inputTokenCoverage)} of reported input tokens. Missing counts are not treated as misses.</p>
      <p>Providers observed: {Object.keys(stats.byProvider).join(", ")}</p>
    </>}
    <small>Local telemetry only. Agent rates exclude background helpers and chat titles. Window: up to 5,000 measured responses.</small>
  </section>;
}
