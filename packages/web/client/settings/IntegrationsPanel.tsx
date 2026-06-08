import React, { useCallback, useEffect, useState } from "react";
import { webApiFetch } from "../webApiAuth.js";

const CYAN = "var(--lim-accent, #00d4ff)";
const AMBER = "var(--lim-warn, #ffb347)";
const GREEN = "var(--lim-success, #00ff88)";
const MAGENTA = "var(--lim-secondary, #ff4488)";

const btn: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: 11,
  padding: "8px 14px",
  borderRadius: 2,
  border: "1px solid rgba(var(--lim-accent-rgb),0.25)",
  background: "rgba(0,12,24,0.8)",
  color: CYAN,
  cursor: "pointer",
};

const btnDanger: React.CSSProperties = { ...btn, color: MAGENTA, borderColor: "rgba(255,68,136,0.35)" };

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

interface GoogleAccount {
  accountId: string;
  email?: string;
  scopes: string[];
  expiresAt: number;
  missingScopes?: string[];
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
  microsoft?: {
    accounts: GoogleAccount[];
    sidecar: { enabled: boolean; running: boolean; port: number; url: string; pid?: number };
    services: string[];
  };
  github?: {
    tokenConfigured: boolean;
    mcpUrl: string;
  };
  xero?: {
    accounts: Array<
      GoogleAccount & {
        tenantId?: string;
        tenantName?: string;
      }
    >;
  };
  connections: ConnectionSummary[];
}

export interface IntegrationsPanelProps {
  agentBusy: boolean;
}

type ExpandedId = "google" | "microsoft" | "xero" | "github" | "advanced" | null;

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 4 }}>{children}</div>;
}

function StatusPill({ connected, label }: { connected: boolean; label?: string }) {
  return (
    <span
      style={{
        fontSize: 10,
        fontFamily: "monospace",
        padding: "2px 8px",
        borderRadius: 2,
        border: `1px solid ${connected ? GREEN : AMBER}`,
        color: connected ? GREEN : AMBER,
      }}
    >
      {label ?? (connected ? "Connected" : "Not connected")}
    </span>
  );
}

function IntegrationRow({
  title,
  summary,
  connected,
  expanded,
  onToggle,
  primaryLabel,
  onPrimary,
  primaryDisabled,
  primaryDanger,
  hidePrimary,
  children,
}: {
  title: string;
  summary: string;
  connected: boolean;
  expanded: boolean;
  onToggle: () => void;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryDanger?: boolean;
  hidePrimary?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      style={{
        marginBottom: 10,
        borderRadius: 2,
        border: "1px solid rgba(var(--lim-accent-rgb),0.15)",
        background: "rgba(0,12,24,0.6)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 12px",
          cursor: "pointer",
        }}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
      >
        <span style={{ fontSize: 12, color: "#8899aa", width: 14 }}>{expanded ? "▾" : "▸"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#dde8f0" }}>{title}</div>
          <div style={{ fontSize: 10, color: "#778899", marginTop: 2, lineHeight: 1.4 }}>{summary}</div>
        </div>
        <StatusPill connected={connected} />
        {hidePrimary ? null : (
          <button
            type="button"
            style={primaryDanger ? btnDanger : btn}
            disabled={primaryDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onPrimary();
            }}
          >
            {primaryLabel}
          </button>
        )}
      </div>
      {expanded && children ? (
        <div
          style={{
            padding: "0 12px 12px 36px",
            borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function IntegrationsPanel({ agentBusy }: IntegrationsPanelProps) {
  const [data, setData] = useState<IntegrationsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<ExpandedId>(null);

  const [mode, setMode] = useState<"read_write" | "read_only">("read_write");
  const [msMode, setMsMode] = useState<"read_write" | "read_only">("read_write");
  const [xeroMode, setXeroMode] = useState<"read_write" | "read_only">("read_write");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [msSelectedServices, setMsSelectedServices] = useState<Set<string>>(new Set());

  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpReadOnly, setMcpReadOnly] = useState(false);
  const [mcpAuthKind, setMcpAuthKind] = useState<"none" | "bearer" | "header" | "basic">("none");
  const [mcpAuthEnv, setMcpAuthEnv] = useState("");
  const [mcpAuthHeader, setMcpAuthHeader] = useState("Authorization");

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
      if (msSelectedServices.size === 0 && (json.microsoft?.services.length ?? 0) > 0) {
        setMsSelectedServices(new Set(json.microsoft!.services));
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

  const toggleMsService = (id: string) => {
    setMsSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: ExpandedId) => {
    setExpanded((prev) => (prev === id ? null : id));
  };

  const accounts = data?.google.accounts ?? [];
  const sidecar = data?.google.sidecar;
  const services = data?.google.services ?? [];
  const connections = data?.connections ?? [];
  const curatedParents = new Set(["google_workspace", "microsoft_365", "github"]);
  const customMcp = connections.filter(
    (c) => c.kind === "mcp" && (!c.parentProvider || !curatedParents.has(c.parentProvider))
  );
  const googleMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "google_workspace");
  const microsoftMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "microsoft_365");
  const githubMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "github");
  const github = data?.github;
  const openApi = connections.filter((c) => c.kind === "openapi");
  const disabled = busy || agentBusy || loading;

  const msAccounts = data?.microsoft?.accounts ?? [];
  const msSidecar = data?.microsoft?.sidecar;
  const msServices = data?.microsoft?.services ?? [];
  const xeroAccounts = data?.xero?.accounts ?? [];

  const googleConnected = googleMcp.length > 0;
  const microsoftConnected = microsoftMcp.length > 0;
  const xeroConnected = xeroAccounts.length > 0;
  const githubConnected = githubMcp.length > 0;
  const googleToolCount = googleMcp.reduce((n, c) => n + c.toolCount, 0);
  const microsoftToolCount = microsoftMcp.reduce((n, c) => n + c.toolCount, 0);
  const githubToolCount = githubMcp.reduce((n, c) => n + c.toolCount, 0);

  const googlePrimary = async () => {
    if (googleConnected) {
      const res = await webApiFetch("/api/integrations/google?revoke=0", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    if (accounts.length === 0) {
      const svc = [...selectedServices].join(",");
      const res = await webApiFetch(
        `/api/integrations/google/begin?mode=${mode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
      );
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const res = await webApiFetch("/api/integrations/google/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ services: [...selectedServices], mode }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "connect failed");
  };

  const microsoftPrimary = async () => {
    if (microsoftConnected) {
      const res = await webApiFetch("/api/integrations/microsoft?revoke=0", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    if (msAccounts.length === 0) {
      const svc = [...msSelectedServices].join(",");
      const res = await webApiFetch(
        `/api/integrations/microsoft/begin?mode=${msMode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
      );
      if (!res.ok) throw new Error(await res.text());
      const { authUrl } = (await res.json()) as { authUrl: string };
      window.open(authUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const res = await webApiFetch("/api/integrations/microsoft/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ services: [...msSelectedServices], mode: msMode }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "connect failed");
  };

  const githubPrimary = async () => {
    if (githubConnected) {
      const res = await webApiFetch("/api/integrations/github", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    const res = await webApiFetch("/api/integrations/github/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "GitHub connect failed");
  };

  const xeroPrimary = async () => {
    if (xeroConnected) {
      const res = await webApiFetch("/api/integrations/xero?revoke=0", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    const res = await webApiFetch(`/api/integrations/xero/begin?mode=${xeroMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontSize: 11, color: AMBER, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>
        INTEGRATIONS
      </div>
      <p style={{ fontSize: 11, color: "#aab8c4", lineHeight: 1.5, marginBottom: 12 }}>
        One tap to connect each service. Tap a row to see options. Google and Xero sign in via{" "}
        <code style={{ color: CYAN }}>vireondynamics.com</code>; GitHub uses a PAT in{" "}
        <code style={{ color: CYAN }}>.env</code>.
      </p>

      {error ? (
        <div style={{ color: MAGENTA, fontSize: 11, marginBottom: 10, fontFamily: "monospace" }}>{error}</div>
      ) : null}

      {agentBusy ? (
        <div style={{ color: AMBER, fontSize: 11, marginBottom: 10 }}>
          Agent is running — wait for the current turn before changing integrations.
        </div>
      ) : null}

      {loading && !data ? <div style={{ fontSize: 11, color: "#778899" }}>Loading…</div> : null}

      <IntegrationRow
        title="Google Workspace"
        summary={
          googleConnected
            ? `${accounts[0]?.email ?? "Google"} · ${googleToolCount} agent tools`
            : accounts.length > 0
              ? `Signed in as ${accounts[0]?.email ?? "Google"} — tap Connect to enable tools`
              : "Gmail, Calendar, Drive, Docs, Sheets"
        }
        connected={googleConnected}
        expanded={expanded === "google"}
        onToggle={() => toggleExpand("google")}
        primaryLabel={googleConnected ? "Disconnect" : "Connect"}
        primaryDanger={googleConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(googlePrimary)}
      >
        <p style={{ fontSize: 10, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Opens Google sign-in, then attaches MCP tools for the agent. Needs{" "}
          <code>GOOGLE_OAUTH_CLIENT_ID</code> / <code>SECRET</code> in .env.
        </p>
        {accounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.accountId} — {a.scopes.length} scopes
            {(a.missingScopes?.length ?? 0) > 0 ? (
              <span style={{ color: AMBER }}> · missing scopes — revoke & reconnect below</span>
            ) : null}
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
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
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
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
        {sidecar ? (
          <div style={{ fontSize: 10, fontFamily: "monospace", color: sidecar.running ? GREEN : AMBER, marginBottom: 10 }}>
            Docs sidecar: {sidecar.running ? sidecar.url : "stopped"}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...btn, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled || accounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/google/connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ services: [...selectedServices], mode }),
                });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "attach failed");
              })
            }
          >
            Re-attach tools
          </button>
          <button
            type="button"
            style={{ ...btnDanger, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled || accounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/google?revoke=1", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "revoke failed");
              })
            }
          >
            Revoke Google access
          </button>
        </div>
      </IntegrationRow>

      <IntegrationRow
        title="Microsoft 365"
        summary={
          microsoftConnected
            ? `${msAccounts[0]?.email ?? "Microsoft"} · ${microsoftToolCount} agent tools`
            : msAccounts.length > 0
              ? `Signed in as ${msAccounts[0]?.email ?? "Microsoft"} — tap Connect to enable tools`
              : "Outlook, Calendar, OneDrive, Teams, Planner"
        }
        connected={microsoftConnected}
        expanded={expanded === "microsoft"}
        onToggle={() => toggleExpand("microsoft")}
        primaryLabel={microsoftConnected ? "Disconnect" : "Connect"}
        primaryDanger={microsoftConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(microsoftPrimary)}
      >
        <p style={{ fontSize: 10, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Opens Microsoft sign-in, then attaches <code>mcp_microsoft_*</code> Graph tools via local sidecar.
          Needs <code>MICROSOFT_OAUTH_CLIENT_ID</code> in .env.
        </p>
        {msAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.accountId} — {a.scopes.length} scopes
            {(a.missingScopes?.length ?? 0) > 0 ? (
              <span style={{ color: AMBER }}> · missing scopes — revoke & reconnect</span>
            ) : null}
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input type="radio" checked={msMode === "read_write"} onChange={() => setMsMode("read_write")} disabled={disabled} />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input type="radio" checked={msMode === "read_only"} onChange={() => setMsMode("read_only")} disabled={disabled} />{" "}
            Read only
          </label>
        </div>
        {msServices.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
            {msServices.map((s) => (
              <label
                key={s}
                style={{
                  fontSize: 10,
                  fontFamily: "monospace",
                  padding: "4px 8px",
                  border: `1px solid ${msSelectedServices.has(s) ? CYAN : "rgba(var(--lim-accent-rgb),0.2)"}`,
                  borderRadius: 2,
                  color: msSelectedServices.has(s) ? CYAN : "#8899aa",
                  cursor: disabled ? "default" : "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={msSelectedServices.has(s)}
                  onChange={() => toggleMsService(s)}
                  disabled={disabled}
                  style={{ marginRight: 4 }}
                />
                {s}
              </label>
            ))}
          </div>
        ) : null}
        {msSidecar ? (
          <div style={{ fontSize: 10, fontFamily: "monospace", color: msSidecar.running ? GREEN : AMBER, marginBottom: 10 }}>
            Graph sidecar: {msSidecar.running ? msSidecar.url : "stopped"}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...btn, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled || msAccounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/microsoft/connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ services: [...msSelectedServices], mode: msMode }),
                });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "attach failed");
              })
            }
          >
            Re-attach tools
          </button>
          <button
            type="button"
            style={{ ...btnDanger, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled || msAccounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/microsoft?revoke=1", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "revoke failed");
              })
            }
          >
            Revoke Microsoft access
          </button>
        </div>
      </IntegrationRow>

      <IntegrationRow
        title="Xero"
        summary={
          xeroConnected
            ? `${xeroAccounts[0]?.email ?? "Xero"}${xeroAccounts[0]?.tenantName ? ` · ${xeroAccounts[0]?.tenantName}` : ""} · invoices & contacts`
            : "Hosted OAuth — invoices, contacts, organisations (no .env setup)"
        }
        connected={xeroConnected}
        expanded={expanded === "xero"}
        onToggle={() => toggleExpand("xero")}
        primaryLabel={xeroConnected ? "Disconnect" : "Connect"}
        primaryDanger={xeroConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(xeroPrimary)}
      >
        <p style={{ fontSize: 10, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Opens Vireon-hosted Xero sign-in, then saves tokens locally. No Azure/Google-style client setup in your{" "}
          <code>.env</code>.
        </p>
        {xeroAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.accountId}
            {a.tenantName ? ` · ${a.tenantName}` : a.tenantId ? ` · tenant ${a.tenantId}` : ""} — {a.scopes.length} scopes
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={xeroMode === "read_write"}
              onChange={() => setXeroMode("read_write")}
              disabled={disabled || xeroConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={xeroMode === "read_only"}
              onChange={() => setXeroMode("read_only")}
              disabled={disabled || xeroConnected}
            />{" "}
            Read only
          </label>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...btn, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled}
            onClick={() => void run(load)}
          >
            Refresh status
          </button>
          <button
            type="button"
            style={{ ...btnDanger, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled || !xeroConnected}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/xero?revoke=1", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "revoke failed");
              })
            }
          >
            Revoke Xero access
          </button>
        </div>
      </IntegrationRow>

      <IntegrationRow
        title="GitHub"
        summary={
          githubConnected
            ? `${githubToolCount} agent tools (issues, PRs, repos)`
            : github?.tokenConfigured
              ? "Token in .env — tap Connect to enable"
              : "Add GITHUB_TOKEN to .env first"
        }
        connected={githubConnected}
        expanded={expanded === "github"}
        onToggle={() => toggleExpand("github")}
        primaryLabel={githubConnected ? "Disconnect" : "Connect"}
        primaryDanger={githubConnected}
        primaryDisabled={disabled || (!githubConnected && !github?.tokenConfigured)}
        onPrimary={() => void run(githubPrimary)}
      >
        <p style={{ fontSize: 10, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Uses official GitHub MCP (<code>mcp_github_*</code>). Create a PAT at github.com/settings/tokens and set{" "}
          <code>GITHUB_TOKEN</code> in .env, then restart the app.
        </p>
        <div
          style={{
            fontSize: 10,
            fontFamily: "monospace",
            marginBottom: 8,
            color: github?.tokenConfigured ? GREEN : AMBER,
          }}
        >
          Token: {github?.tokenConfigured ? "found in environment" : "not configured"}
        </div>
      </IntegrationRow>

      <IntegrationRow
        title="Advanced"
        summary={`Custom MCP (${customMcp.length}) · OpenAPI (${openApi.length}) — tap to configure`}
        connected={customMcp.length + openApi.length > 0}
        expanded={expanded === "advanced"}
        onToggle={() => toggleExpand("advanced")}
        primaryLabel=""
        hidePrimary
        onPrimary={() => {}}
      >
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 11, color: AMBER, fontWeight: 600, marginBottom: 8 }}>Custom MCP</div>
          <p style={{ fontSize: 10, color: "#778899", marginBottom: 8 }}>
            Streamable HTTP servers → <code>mcp_&lt;name&gt;_*</code> tools.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <FieldLabel>Name</FieldLabel>
              <input style={input} value={mcpName} onChange={(e) => setMcpName(e.target.value)} placeholder="slack" disabled={disabled} />
            </div>
            <div>
              <FieldLabel>MCP URL</FieldLabel>
              <input style={input} value={mcpUrl} onChange={(e) => setMcpUrl(e.target.value)} placeholder="https://host/mcp" disabled={disabled} />
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
                <FieldLabel>Header</FieldLabel>
                <input style={input} value={mcpAuthHeader} onChange={(e) => setMcpAuthHeader(e.target.value)} disabled={disabled} />
              </div>
            ) : null}
            {mcpAuthKind !== "none" ? (
              <div>
                <FieldLabel>Env var</FieldLabel>
                <input style={input} value={mcpAuthEnv} onChange={(e) => setMcpAuthEnv(e.target.value)} placeholder="MY_TOKEN" disabled={disabled} />
              </div>
            ) : null}
          </div>
          <label style={{ fontSize: 11, color: "#aabbcc", display: "block", marginBottom: 8 }}>
            <input type="checkbox" checked={mcpReadOnly} onChange={(e) => setMcpReadOnly(e.target.checked)} disabled={disabled} /> Read-only
          </label>
          <button
            type="button"
            style={{ ...btn, fontSize: 10, marginBottom: 12 }}
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
            Attach MCP
          </button>
          {customMcp.map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 0",
                borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              <div>
                <div style={{ color: CYAN }}>{c.name}</div>
                <div style={{ color: "#667788" }}>{c.toolCount} tools</div>
              </div>
              <button
                type="button"
                style={{ ...btnDanger, fontSize: 10, padding: "4px 8px" }}
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const res = await webApiFetch(`/api/integrations/mcp/${encodeURIComponent(c.name)}`, { method: "DELETE" });
                    const json = (await res.json()) as { error?: string };
                    if (!res.ok) throw new Error(json.error ?? "detach failed");
                  })
                }
              >
                Detach
              </button>
            </div>
          ))}

          <div style={{ fontSize: 11, color: AMBER, fontWeight: 600, margin: "16px 0 8px" }}>OpenAPI</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
            <div>
              <FieldLabel>Name</FieldLabel>
              <input style={input} value={apiName} onChange={(e) => setApiName(e.target.value)} placeholder="linear" disabled={disabled} />
            </div>
            <div>
              <FieldLabel>Spec URL</FieldLabel>
              <input style={input} value={apiSpecUrl} onChange={(e) => setApiSpecUrl(e.target.value)} placeholder="openapi.json" disabled={disabled} />
            </div>
          </div>
          <button
            type="button"
            style={{ ...btn, fontSize: 10 }}
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
              })
            }
          >
            Connect OpenAPI
          </button>
          {openApi.map((c) => (
            <div
              key={c.name}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                padding: "6px 0",
                borderTop: "1px solid rgba(var(--lim-accent-rgb),0.08)",
                fontSize: 10,
                fontFamily: "monospace",
              }}
            >
              <div>
                <div style={{ color: CYAN }}>{c.name}</div>
                <div style={{ color: "#667788" }}>{c.toolCount} ops</div>
              </div>
              <button
                type="button"
                style={{ ...btnDanger, fontSize: 10, padding: "4px 8px" }}
                disabled={disabled}
                onClick={() =>
                  void run(async () => {
                    const res = await webApiFetch(`/api/integrations/openapi/${encodeURIComponent(c.name)}`, { method: "DELETE" });
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
      </IntegrationRow>
    </div>
  );
}
