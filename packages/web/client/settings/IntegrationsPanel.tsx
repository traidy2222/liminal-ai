import React, { useCallback, useEffect, useState } from "react";
import { webApiFetch } from "../webApiAuth.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const AMBER = "var(--lim-warn, #ffb347)";
const GREEN = "var(--lim-success, #00ff88)";
const MAGENTA = "var(--lim-secondary, #ff4488)";

const btn: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  padding: "8px 12px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  background: "rgba(0,12,24,0.8)",
  color: CYAN,
  cursor: "pointer",
};

const input: React.CSSProperties = {
  width: "100%",
  fontSize: 11,
  fontFamily: "monospace",
  padding: "6px 8px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.2)",
  background: "rgba(0,10,20,0.95)",
  color: "#dde8f0",
  boxSizing: "border-box",
};

const card: React.CSSProperties = {
  marginBottom: 16,
  padding: 12,
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
  background: "rgba(0,12,24,0.6)",
};

interface GoogleAccount {
  accountId: string;
  email?: string;
  scopes: string[];
  expiresAt: number;
}

interface ConnectionSummary {
  kind: "mcp" | "openapi";
  name: string;
  toolCount: number;
  sampleTools: string[];
  authKind: string;
  attachedAt: number;
  parentProvider?: string;
  serverUrl?: string;
  specUrl?: string;
  baseUrl?: string;
  readOnly?: boolean;
  services?: string[];
}

interface IntegrationsData {
  google: {
    accounts: GoogleAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
  };
  connections: ConnectionSummary[];
}

export interface IntegrationsPanelProps {
  agentBusy: boolean;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, color: AMBER, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>
      {children}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 4 }}>{children}</div>;
}

export function IntegrationsPanel({ agentBusy }: IntegrationsPanelProps) {
  const [data, setData] = useState<IntegrationsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Google
  const [mode, setMode] = useState<"read_write" | "read_only">("read_write");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());

  // Custom MCP form
  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpReadOnly, setMcpReadOnly] = useState(false);
  const [mcpAuthKind, setMcpAuthKind] = useState<"none" | "bearer" | "header" | "basic">("none");
  const [mcpAuthEnv, setMcpAuthEnv] = useState("");
  const [mcpAuthHeader, setMcpAuthHeader] = useState("Authorization");

  // OpenAPI form
  const [apiName, setApiName] = useState("");
  const [apiSpecUrl, setApiSpecUrl] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiAuthKind, setApiAuthKind] = useState<"none" | "bearer" | "header" | "basic">("bearer");
  const [apiAuthEnv, setApiAuthEnv] = useState("");
  const [apiAuthHeader, setApiAuthHeader] = useState("X-Api-Key");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await webApiFetch("/api/integrations");
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as IntegrationsData;
      setData(json);
      if (selectedServices.size === 0 && json.google.services.length > 0) {
        setSelectedServices(new Set(json.google.services));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [selectedServices.size]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const buildAuth = (
    kind: "none" | "bearer" | "header" | "basic",
    envVar: string,
    headerName: string
  ) => {
    if (kind === "none" || !envVar.trim()) return { kind: "none" as const };
    if (kind === "header") return { kind, envVar: envVar.trim(), headerName: headerName.trim() || "Authorization" };
    return { kind, envVar: envVar.trim() };
  };

  const toggleService = (id: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const accounts = data?.google.accounts ?? [];
  const sidecar = data?.google.sidecar;
  const services = data?.google.services ?? [];
  const connections = data?.connections ?? [];
  const customMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider !== "google_workspace");
  const googleMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "google_workspace");
  const openApi = connections.filter((c) => c.kind === "openapi");
  const disabled = busy || agentBusy || loading;

  return (
    <div style={{ paddingBottom: 16 }}>
      <SectionTitle>INTEGRATIONS</SectionTitle>
      <p style={{ fontSize: 11, color: "#aab8c4", lineHeight: 1.5, marginBottom: 12 }}>
        Connect external services for the agent. Curated providers, custom MCP servers, and OpenAPI specs all
        persist under <code style={{ color: CYAN }}>~/.liminal/api_connections/</code>. Secrets stay in{" "}
        <code style={{ color: CYAN }}>.env</code> — only env var names are stored.
      </p>

      {error ? (
        <div style={{ color: MAGENTA, fontSize: 11, marginBottom: 10, fontFamily: "monospace" }}>{error}</div>
      ) : null}

      {agentBusy ? (
        <div style={{ color: AMBER, fontSize: 11, marginBottom: 10 }}>
          Agent is running — wait for the current turn before attaching or detaching connections.
        </div>
      ) : null}

      {/* ── Providers: Google ── */}
      <div style={card}>
        <SectionTitle>PROVIDERS — GOOGLE WORKSPACE</SectionTitle>
        <p style={{ fontSize: 10, color: "#778899", marginBottom: 10, lineHeight: 1.45 }}>
          OAuth + hybrid MCP (official Drive/Gmail/Calendar + sidecar for Docs/Sheets). Requires{" "}
          <code>GOOGLE_OAUTH_CLIENT_ID</code> / <code>GOOGLE_OAUTH_CLIENT_SECRET</code> in .env.
        </p>

        {loading && !data ? (
          <div style={{ fontSize: 11, color: "#778899" }}>Loading…</div>
        ) : accounts.length === 0 ? (
          <div style={{ fontSize: 11, color: AMBER, marginBottom: 10 }}>OAuth not connected</div>
        ) : (
          accounts.map((a) => (
            <div key={a.accountId} style={{ fontSize: 12, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
              {a.email ?? a.accountId} — {a.scopes.length} scopes
            </div>
          ))
        )}

        <div style={{ marginTop: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input type="radio" checked={mode === "read_write"} onChange={() => setMode("read_write")} disabled={disabled} />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input type="radio" checked={mode === "read_only"} onChange={() => setMode("read_only")} disabled={disabled} />{" "}
            Read only
          </label>
        </div>

        {services.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
            {services.map((s) => (
              <label
                key={s}
                style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  padding: "4px 8px",
                  border: `1px solid ${selectedServices.has(s) ? CYAN : "rgba(var(--lim-accent-rgb),0.2)"}`,
                  borderRadius: 2,
                  color: selectedServices.has(s) ? CYAN : "#8899aa",
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedServices.has(s)}
                  onChange={() => toggleService(s)}
                  disabled={disabled}
                  style={{ marginRight: 4 }}
                />
                {s}
              </label>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
          <button
            type="button"
            style={btn}
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const svc = [...selectedServices].join(",");
                const res = await webApiFetch(
                  `/api/integrations/google/begin?mode=${mode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
                );
                if (!res.ok) throw new Error(await res.text());
                const { authUrl } = (await res.json()) as { authUrl: string };
                window.open(authUrl, "_blank", "noopener,noreferrer");
              })
            }
          >
            Connect Google (OAuth)
          </button>
          <button
            type="button"
            style={btn}
            disabled={disabled || accounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/google/connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ services: [...selectedServices], mode }),
                });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "connect failed");
              })
            }
          >
            Attach MCP tools
          </button>
          <button
            type="button"
            style={{ ...btn, color: MAGENTA }}
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/google?revoke=0", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "disconnect failed");
              })
            }
          >
            Disconnect tools
          </button>
          <button
            type="button"
            style={{ ...btn, color: MAGENTA }}
            disabled={disabled}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/google?revoke=1", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "revoke failed");
              })
            }
          >
            Revoke OAuth
          </button>
        </div>

        {sidecar ? (
          <div style={{ fontSize: 10, fontFamily: "monospace", color: sidecar.running ? GREEN : AMBER }}>
            Sidecar: {sidecar.running ? sidecar.url : "stopped"}
            {!sidecar.enabled ? " (AGENT_GOOGLE_SIDECAR_ENABLE=0)" : ""}
          </div>
        ) : null}

        {googleMcp.length > 0 ? (
          <div style={{ marginTop: 10, fontSize: 10, color: "#8899aa" }}>
            Active Google MCP: {googleMcp.map((c) => `${c.name} (${c.toolCount})`).join(", ")}
          </div>
        ) : null}
      </div>

      {/* ── Custom MCP ── */}
      <div style={card}>
        <SectionTitle>CUSTOM MCP</SectionTitle>
        <p style={{ fontSize: 10, color: "#778899", marginBottom: 10, lineHeight: 1.45 }}>
          Attach any Streamable HTTP MCP server. Tools register as <code>mcp_&lt;name&gt;_*</code>.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <FieldLabel>Connection name</FieldLabel>
            <input style={input} value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="github" disabled={disabled} />
          </div>
          <div>
            <FieldLabel>MCP URL</FieldLabel>
            <input
              style={input}
              value={mcpUrl}
              onChange={(e) => setMcpUrl(e.target.value)}
              placeholder="https://host/mcp"
              disabled={disabled}
            />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, marginBottom: 8, alignItems: "end" }}>
          <div>
            <FieldLabel>Auth</FieldLabel>
            <select
              style={input}
              value={mcpAuthKind}
              onChange={(e) => setMcpAuthKind(e.target.value as typeof mcpAuthKind)}
              disabled={disabled}
            >
              <option value="none">none</option>
              <option value="bearer">bearer</option>
              <option value="header">header</option>
              <option value="basic">basic</option>
            </select>
          </div>
          {mcpAuthKind === "header" ? (
            <div>
              <FieldLabel>Header name</FieldLabel>
              <input style={input} value={mcpAuthHeader} onChange={(e) => setMcpAuthHeader(e.target.value)} disabled={disabled} />
            </div>
          ) : null}
          {mcpAuthKind !== "none" ? (
            <div>
              <FieldLabel>Env var (secret in .env)</FieldLabel>
              <input style={input} value={mcpAuthEnv} onChange={(e) => setMcpAuthEnv(e.target.value)} placeholder="MY_MCP_TOKEN" disabled={disabled} />
            </div>
          ) : null}
        </div>

        <label style={{ fontSize: 11, color: "#aabbcc", display: "block", marginBottom: 10 }}>
          <input type="checkbox" checked={mcpReadOnly} onChange={(e) => setMcpReadOnly(e.target.checked)} disabled={disabled} />{" "}
          Read-only (skip write tools)
        </label>

        <button
          type="button"
          style={btn}
          disabled={disabled || !mcpName.trim() || !mcpUrl.trim()}
          onClick={() =>
            void run(async () => {
              const res = await webApiFetch("/api/integrations/mcp", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: mcpName.trim(),
                  url: mcpUrl.trim(),
                  read_only: mcpReadOnly,
                  auth: buildAuth(mcpAuthKind, mcpAuthEnv, mcpAuthHeader),
                }),
              });
              const json = (await res.json()) as { error?: string };
              if (!res.ok) throw new Error(json.error ?? "attach failed");
              setMcpName("");
              setMcpUrl("");
            })
          }
        >
          Attach MCP server
        </button>

        {customMcp.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <FieldLabel>Connected</FieldLabel>
            {customMcp.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 0",
                  borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: CYAN }}>{c.name}</div>
                  <div style={{ color: "#778899", fontSize: 10, wordBreak: "break-all" }}>{c.serverUrl}</div>
                  <div style={{ color: "#667788", fontSize: 10 }}>
                    {c.toolCount} tools · auth={c.authKind}
                    {c.readOnly ? " · read-only" : ""}
                  </div>
                  {c.sampleTools.length > 0 ? (
                    <div style={{ color: "#556677", fontSize: 9, marginTop: 4 }}>{c.sampleTools.join(", ")}…</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  style={{ ...btn, color: MAGENTA, flexShrink: 0 }}
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      const res = await webApiFetch(`/api/integrations/mcp/${encodeURIComponent(c.name)}`, {
                        method: "DELETE",
                      });
                      const json = (await res.json()) as { error?: string };
                      if (!res.ok) throw new Error(json.error ?? "detach failed");
                    })
                  }
                >
                  Detach
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 10, color: "#667788" }}>No custom MCP connections yet.</div>
        )}
      </div>

      {/* ── OpenAPI ── */}
      <div style={card}>
        <SectionTitle>OPENAPI</SectionTitle>
        <p style={{ fontSize: 10, color: "#778899", marginBottom: 10, lineHeight: 1.45 }}>
          Import an OpenAPI 3.x JSON spec. Tools register as <code>api_&lt;name&gt;_*</code>. YAML specs must be
          converted to JSON first.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
          <div>
            <FieldLabel>Connection name</FieldLabel>
            <input style={input} value={apiName} onChange={(e) => setApiName(e.target.value)} placeholder="linear" disabled={disabled} />
          </div>
          <div>
            <FieldLabel>Spec URL (JSON)</FieldLabel>
            <input
              style={input}
              value={apiSpecUrl}
              onChange={(e) => setApiSpecUrl(e.target.value)}
              placeholder="https://…/openapi.json"
              disabled={disabled}
            />
          </div>
        </div>

        <div style={{ marginBottom: 8 }}>
          <FieldLabel>Base URL override (optional)</FieldLabel>
          <input style={input} value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} placeholder="https://api.example.com" disabled={disabled} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, marginBottom: 10, alignItems: "end" }}>
          <div>
            <FieldLabel>Auth</FieldLabel>
            <select
              style={input}
              value={apiAuthKind}
              onChange={(e) => setApiAuthKind(e.target.value as typeof apiAuthKind)}
              disabled={disabled}
            >
              <option value="none">none</option>
              <option value="bearer">bearer</option>
              <option value="header">header</option>
              <option value="basic">basic</option>
            </select>
          </div>
          {apiAuthKind === "header" ? (
            <div>
              <FieldLabel>Header name</FieldLabel>
              <input style={input} value={apiAuthHeader} onChange={(e) => setApiAuthHeader(e.target.value)} disabled={disabled} />
            </div>
          ) : null}
          {apiAuthKind !== "none" ? (
            <div>
              <FieldLabel>Env var</FieldLabel>
              <input style={input} value={apiAuthEnv} onChange={(e) => setApiAuthEnv(e.target.value)} placeholder="LINEAR_API_KEY" disabled={disabled} />
            </div>
          ) : null}
        </div>

        <button
          type="button"
          style={btn}
          disabled={disabled || !apiName.trim() || !apiSpecUrl.trim()}
          onClick={() =>
            void run(async () => {
              const res = await webApiFetch("/api/integrations/openapi", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  name: apiName.trim(),
                  specUrl: apiSpecUrl.trim(),
                  baseUrl: apiBaseUrl.trim() || undefined,
                  auth: buildAuth(apiAuthKind, apiAuthEnv, apiAuthHeader),
                }),
              });
              const json = (await res.json()) as { error?: string };
              if (!res.ok) throw new Error(json.error ?? "connect failed");
              setApiName("");
              setApiSpecUrl("");
              setApiBaseUrl("");
            })
          }
        >
          Connect OpenAPI spec
        </button>

        {openApi.length > 0 ? (
          <div style={{ marginTop: 14 }}>
            <FieldLabel>Connected</FieldLabel>
            {openApi.map((c) => (
              <div
                key={c.name}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: "8px 0",
                  borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
                  fontSize: 11,
                  fontFamily: "monospace",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: CYAN }}>{c.name}</div>
                  <div style={{ color: "#778899", fontSize: 10, wordBreak: "break-all" }}>{c.specUrl}</div>
                  <div style={{ color: "#667788", fontSize: 10 }}>
                    {c.toolCount} ops · base={c.baseUrl ?? "—"} · auth={c.authKind}
                  </div>
                  {c.sampleTools.length > 0 ? (
                    <div style={{ color: "#556677", fontSize: 9, marginTop: 4 }}>{c.sampleTools.join(", ")}…</div>
                  ) : null}
                </div>
                <button
                  type="button"
                  style={{ ...btn, color: MAGENTA, flexShrink: 0 }}
                  disabled={disabled}
                  onClick={() =>
                    void run(async () => {
                      const res = await webApiFetch(`/api/integrations/openapi/${encodeURIComponent(c.name)}`, {
                        method: "DELETE",
                      });
                      const json = (await res.json()) as { error?: string };
                      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
                    })
                  }
                >
                  Disconnect
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ marginTop: 10, fontSize: 10, color: "#667788" }}>No OpenAPI connections yet.</div>
        )}
      </div>
    </div>
  );
}
