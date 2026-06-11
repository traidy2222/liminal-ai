import React, { useCallback, useEffect, useState } from "react";
import { webApiFetch } from "../webApiAuth.js";
import {
  INTEGRATION_BRANDS,
  IntegrationBrandLogo,
  type IntegrationBrandId,
} from "./integrationBrands.js";

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
    accounts: Array<GoogleAccount & { login?: string }>;
  };
  xero?: {
    accounts: Array<
      GoogleAccount & {
        tenantId?: string;
        tenantName?: string;
        missingScopes?: string[];
        missingCoreScopes?: string[];
        missingExtendedScopes?: string[];
      }
    >;
  };
  slack?: {
    accounts: Array<
      GoogleAccount & {
        teamId?: string;
        teamName?: string;
      }
    >;
  };
  linear?: {
    accounts: Array<
      GoogleAccount & {
        organizationName?: string;
      }
    >;
  };
  notion?: {
    accounts: Array<
      GoogleAccount & {
        workspaceId?: string;
        workspaceName?: string;
      }
    >;
  };
  connections: ConnectionSummary[];
}

export interface IntegrationsPanelProps {
  agentBusy: boolean;
}

type ExpandedId = "google" | "microsoft" | "xero" | "slack" | "linear" | "notion" | "github" | "advanced" | null;

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

function IntegrationCard({
  brandId,
  statusLine,
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
  brandId: IntegrationBrandId;
  statusLine: string;
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
  const brand = INTEGRATION_BRANDS[brandId];
  return (
    <div
      style={{
        gridColumn: expanded ? "1 / -1" : undefined,
        borderRadius: 10,
        border: `1px solid ${connected ? "rgba(0,255,136,0.35)" : "rgba(var(--lim-accent-rgb),0.14)"}`,
        background: connected ? "rgba(0,255,136,0.04)" : "rgba(0,12,24,0.65)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: expanded ? undefined : 196,
      }}
    >
      <div
        style={{
          padding: "14px 12px 12px",
          cursor: "pointer",
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onToggle();
        }}
      >
        <IntegrationBrandLogo id={brandId} size={52} />
        <div style={{ marginTop: 10, fontSize: 14, fontWeight: 600, color: "#e8f0f8" }}>{brand.title}</div>
        <div style={{ fontSize: 11, color: "#8fa0b0", marginTop: 4, lineHeight: 1.4, minHeight: 30 }}>
          {statusLine}
        </div>
        <div style={{ marginTop: 8 }}>
          <StatusPill connected={connected} label={connected ? "Connected" : "Not connected"} />
        </div>
        {hidePrimary ? (
          <div style={{ fontSize: 10, color: "#667788", marginTop: 10 }}>Tap for options</div>
        ) : (
          <button
            type="button"
            style={{
              ...(primaryDanger ? btnDanger : btn),
              marginTop: 10,
              width: "100%",
              maxWidth: 140,
            }}
            disabled={primaryDisabled}
            onClick={(e) => {
              e.stopPropagation();
              onPrimary();
            }}
          >
            {primaryLabel}
          </button>
        )}
        <div style={{ fontSize: 10, color: "#556677", marginTop: 8 }}>
          {expanded ? "Hide options ▴" : "More options ▾"}
        </div>
      </div>
      {expanded && children ? (
        <div
          style={{
            padding: "12px 14px 14px",
            borderTop: "1px solid rgba(var(--lim-accent-rgb),0.1)",
            textAlign: "left",
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
  const [xeroExtended, setXeroExtended] = useState(false);
  const [slackMode, setSlackMode] = useState<"read_write" | "read_only">("read_write");
  const [linearMode, setLinearMode] = useState<"read_write" | "read_only">("read_write");
  const [notionMode, setNotionMode] = useState<"read_write" | "read_only">("read_write");
  const [githubMode, setGithubMode] = useState<"read_write" | "read_only">("read_write");
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
  }, [selectedServices.size, msSelectedServices.size]);

  useEffect(() => {
    void load();
  }, [load]);

  const googleToolsConnected = (d: IntegrationsData) =>
    d.connections.some((c) => c.parentProvider === "google_workspace");

  const microsoftToolsConnected = (d: IntegrationsData) =>
    d.connections.some((c) => c.parentProvider === "microsoft_365");

  /** Poll after opening a browser OAuth tab until tokens/tools appear on the harness. */
  const pollIntegrationsUntil = async (
    predicate: (d: IntegrationsData) => boolean,
    timeoutMs = 10 * 60_000
  ) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await webApiFetch("/api/integrations");
      if (!res.ok) continue;
      const json = (await res.json()) as IntegrationsData;
      setData(json);
      if (predicate(json)) return;
    }
    throw new Error("Timed out waiting for sign-in — complete consent in the browser tab.");
  };

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
  const googleCalendarAttached = googleMcp.some((c) => c.name === "google_calendar");
  const microsoftMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "microsoft_365");
  const msGraphConn = microsoftMcp.find((c) => c.name === "microsoft");
  const msCalendarAttached = msGraphConn?.services?.includes("calendar") ?? false;
  const githubMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "github");
  const openApi = connections.filter((c) => c.kind === "openapi");
  const disabled = busy || agentBusy || loading;

  const msAccounts = data?.microsoft?.accounts ?? [];
  const msSidecar = data?.microsoft?.sidecar;
  const msServices = data?.microsoft?.services ?? [];
  const xeroAccounts = data?.xero?.accounts ?? [];
  const slackAccounts = data?.slack?.accounts ?? [];
  const linearAccounts = data?.linear?.accounts ?? [];
  const notionAccounts = data?.notion?.accounts ?? [];
  const googleConnected = googleMcp.length > 0;
  const microsoftConnected = microsoftMcp.length > 0;
  const xeroConnected = xeroAccounts.length > 0;
  const slackConnected = slackAccounts.length > 0;
  const linearConnected = linearAccounts.length > 0;
  const notionConnected = notionAccounts.length > 0;
  const githubConnected = githubMcp.length > 0;
  const googleToolCount = googleMcp.reduce((n, c) => n + c.toolCount, 0);
  const microsoftToolCount = microsoftMcp.reduce((n, c) => n + c.toolCount, 0);
  const githubToolCount = githubMcp.reduce((n, c) => n + c.toolCount, 0);

  const googlePrimary = async () => {
    if (googleConnected) {
      const res = await webApiFetch("/api/integrations/google?revoke=1", { method: "DELETE" });
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
      await pollIntegrationsUntil((d) => googleToolsConnected(d));
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
      const res = await webApiFetch("/api/integrations/microsoft?revoke=1", { method: "DELETE" });
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
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => microsoftToolsConnected(d));
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

  const githubAccounts = data?.github?.accounts ?? [];

  const githubPrimary = async () => {
    if (githubConnected) {
      const res = await webApiFetch("/api/integrations/github?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    if (githubAccounts.length > 0) {
      const res = await webApiFetch("/api/integrations/github/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: githubMode }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "GitHub connect failed");
      return;
    }
    const res = await webApiFetch(`/api/integrations/github/begin?mode=${githubMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil(
      (d) => d.connections.some((c) => c.parentProvider === "github") || (d.github?.accounts.length ?? 0) > 0
    );
  };

  const beginXeroOAuth = async () => {
    const qs = new URLSearchParams({ mode: xeroMode });
    if (xeroExtended) qs.set("extended", "1");
    const res = await webApiFetch(`/api/integrations/xero/begin?${qs.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.xero?.accounts.length ?? 0) > 0);
  };

  const xeroPrimary = async () => {
    if (xeroConnected) {
      const res = await webApiFetch("/api/integrations/xero?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    await beginXeroOAuth();
  };

  const xeroReconnect = async () => {
    if (xeroConnected) {
      const res = await webApiFetch("/api/integrations/xero?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
    }
    await beginXeroOAuth();
  };

  const slackPrimary = async () => {
    if (slackConnected) {
      const res = await webApiFetch("/api/integrations/slack?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    const res = await webApiFetch(`/api/integrations/slack/begin?mode=${slackMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.slack?.accounts.length ?? 0) > 0);
  };

  const linearPrimary = async () => {
    if (linearConnected) {
      const res = await webApiFetch("/api/integrations/linear?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    const res = await webApiFetch(`/api/integrations/linear/begin?mode=${linearMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.linear?.accounts.length ?? 0) > 0);
  };

  const notionPrimary = async () => {
    if (notionConnected) {
      const res = await webApiFetch("/api/integrations/notion?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
      return;
    }
    const res = await webApiFetch(`/api/integrations/notion/begin?mode=${notionMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.notion?.accounts.length ?? 0) > 0);
  };

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontSize: 11, color: AMBER, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>
        INTEGRATIONS
      </div>
      <p style={{ fontSize: 12, color: "#aab8c4", lineHeight: 1.5, marginBottom: 14 }}>
        Connect the apps you use every day. Sign in once — your agent can then read email, files, code, and more. Tap a
        card for settings.
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

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(152px, 1fr))",
          gap: 12,
          alignItems: "stretch",
        }}
      >
      <IntegrationCard
        brandId="google"
        statusLine={
          googleConnected
            ? `Ready · ${googleToolCount} tools for your agent`
            : accounts.length > 0
              ? busy
                ? `Finishing sign-in as ${accounts[0]?.email ?? "you"}…`
                : `Signed in — tap Enable tools`
              : INTEGRATION_BRANDS.google.tagline
        }
        connected={googleConnected}
        expanded={expanded === "google"}
        onToggle={() => toggleExpand("google")}
        primaryLabel={
          googleConnected ? "Disconnect" : accounts.length > 0 ? "Enable tools" : "Connect"
        }
        primaryDanger={googleConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(googlePrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Google to let your agent read and send email, manage calendar events, and work with Drive files.
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
        {accounts.length > 0 && !googleCalendarAttached ? (
          <p style={{ fontSize: 11, color: AMBER, lineHeight: 1.35, margin: "0 0 8px" }}>
            Gmail may work while Calendar MCP is not attached — enable Calendar separately.
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {accounts.length > 0 && !googleCalendarAttached ? (
            <button
              type="button"
              style={{ ...btn, fontSize: 10, padding: "6px 10px", borderColor: CYAN, color: CYAN }}
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const res = await webApiFetch("/api/integrations/google/connect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ services: ["calendar"], mode }),
                  });
                  const json = (await res.json()) as { error?: string };
                  if (!res.ok) throw new Error(json.error ?? "attach failed");
                })
              }
            >
              Attach Calendar
            </button>
          ) : null}
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
      </IntegrationCard>

      <IntegrationCard
        brandId="microsoft"
        statusLine={
          microsoftConnected
            ? `Ready · ${microsoftToolCount} tools for your agent`
            : msAccounts.length > 0
              ? `Signed in — tap Connect`
              : INTEGRATION_BRANDS.microsoft.tagline
        }
        connected={microsoftConnected}
        expanded={expanded === "microsoft"}
        onToggle={() => toggleExpand("microsoft")}
        primaryLabel={microsoftConnected ? "Disconnect" : "Connect"}
        primaryDanger={microsoftConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(microsoftPrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Microsoft to use Outlook, Calendar, OneDrive, and Teams from your agent.
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
        {msAccounts.length > 0 && microsoftConnected && !msCalendarAttached ? (
          <p style={{ fontSize: 11, color: AMBER, lineHeight: 1.35, margin: "0 0 8px" }}>
            Outlook mail may work while Calendar is not in your attached Graph services — enable Calendar separately.
          </p>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {msAccounts.length > 0 && !msCalendarAttached ? (
            <button
              type="button"
              style={{ ...btn, fontSize: 10, padding: "6px 10px", borderColor: CYAN, color: CYAN }}
              disabled={disabled}
              onClick={() =>
                void run(async () => {
                  const res = await webApiFetch("/api/integrations/microsoft/connect", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ services: ["calendar"], mode: msMode }),
                  });
                  const json = (await res.json()) as { error?: string };
                  if (!res.ok) throw new Error(json.error ?? "attach failed");
                })
              }
            >
              Attach Calendar
            </button>
          ) : null}
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
      </IntegrationCard>

      <IntegrationCard
        brandId="xero"
        statusLine={
          xeroConnected
            ? (xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0
              ? `Reconnect needed · ${xeroAccounts[0]?.missingCoreScopes?.length} core scopes missing`
              : (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0
                ? `Accounting ready · enable Extended APIs + reconnect for files/projects/payroll`
                : `Ready · ${xeroAccounts[0]?.tenantName ?? xeroAccounts[0]?.email ?? "account linked"}`
            : INTEGRATION_BRANDS.xero.tagline
        }
        connected={xeroConnected}
        expanded={expanded === "xero"}
        onToggle={() => toggleExpand("xero")}
        primaryLabel={
          xeroConnected &&
          ((xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0 ||
            (xeroExtended && (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0))
            ? "Reconnect"
            : xeroConnected
              ? "Disconnect"
              : "Connect"
        }
        primaryDanger={
          xeroConnected &&
          (xeroAccounts[0]?.missingCoreScopes?.length ?? 0) === 0 &&
          !(xeroExtended && (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0)
        }
        primaryDisabled={disabled}
        onPrimary={() =>
          void run(
            xeroConnected &&
              ((xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0 ||
                (xeroExtended && (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0))
              ? xeroReconnect
              : xeroPrimary
          )
        }
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Xero to look up invoices, contacts, and organisation details.
        </p>
        {(xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0 ? (
          <p style={{ fontSize: 11, color: "#e6b84d", lineHeight: 1.45, margin: "0 0 10px" }}>
            Core accounting scopes are missing. Click <strong>Reconnect</strong> (leave Extended APIs off
            first if you saw <code>invalid_scope</code>).
          </p>
        ) : (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0 ? (
          <p style={{ fontSize: 11, color: "#e6b84d", lineHeight: 1.45, margin: "0 0 10px" }}>
            For files, projects, and payroll tools: enable <strong>Extended APIs</strong> below, then{" "}
            <strong>Reconnect</strong>. Your Xero app must include those products at developer.xero.com.
          </p>
        ) : null}
        {xeroAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.accountId}
            {a.tenantName ? ` · ${a.tenantName}` : a.tenantId ? ` · tenant ${a.tenantId}` : ""} — {a.scopes.length} scopes
            {(a.missingScopes?.length ?? 0) > 0 ? (
              <span style={{ color: "#e6b84d" }}>
                {" "}
                · missing: {a.missingScopes!.slice(0, 4).join(", ")}
                {a.missingScopes!.length > 4 ? ", …" : ""}
              </span>
            ) : null}
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
        <label style={{ display: "block", fontSize: 11, color: "#aabbcc", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={xeroExtended}
            onChange={(e) => setXeroExtended(e.target.checked)}
            disabled={disabled || xeroConnected}
          />{" "}
          Extended APIs (files, projects, payroll, GL journals) — only if enabled on your Xero app
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...btn, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled}
            onClick={() => void run(load)}
          >
            Refresh status
          </button>
          {xeroConnected &&
          ((xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0 ||
            (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0) ? (
            <button
              type="button"
              style={{ ...btn, fontSize: 10, padding: "6px 10px", borderColor: "#e6b84d", color: "#e6b84d" }}
              disabled={disabled}
              onClick={() => void run(xeroReconnect)}
            >
              Reconnect for new scopes
            </button>
          ) : null}
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
      </IntegrationCard>

      <IntegrationCard
        brandId="slack"
        statusLine={
          slackConnected
            ? `Ready · ${slackAccounts[0]?.teamName ?? slackAccounts[0]?.email ?? "workspace linked"}`
            : INTEGRATION_BRANDS.slack.tagline
        }
        connected={slackConnected}
        expanded={expanded === "slack"}
        onToggle={() => toggleExpand("slack")}
        primaryLabel={slackConnected ? "Disconnect" : "Connect"}
        primaryDanger={slackConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(slackPrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Slack so your agent can read channels and post updates (with your approval).
        </p>
        {slackAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.teamName ?? a.email ?? a.accountId} — {a.scopes.length} scopes
            {(a.missingScopes?.length ?? 0) > 0 ? (
              <span style={{ color: AMBER }}> · missing scopes — disconnect & reconnect below</span>
            ) : null}
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={slackMode === "read_write"}
              onChange={() => setSlackMode("read_write")}
              disabled={disabled || slackConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={slackMode === "read_only"}
              onChange={() => setSlackMode("read_only")}
              disabled={disabled || slackConnected}
            />{" "}
            Read only
          </label>
        </div>
      </IntegrationCard>

      <IntegrationCard
        brandId="linear"
        statusLine={
          linearConnected
            ? `Ready · ${linearAccounts[0]?.organizationName ?? linearAccounts[0]?.email ?? "workspace linked"}`
            : INTEGRATION_BRANDS.linear.tagline
        }
        connected={linearConnected}
        expanded={expanded === "linear"}
        onToggle={() => toggleExpand("linear")}
        primaryLabel={linearConnected ? "Disconnect" : "Connect"}
        primaryDanger={linearConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(linearPrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Linear so your agent can list issues, read details, and create tickets (with approval).
        </p>
        {linearAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.organizationName ?? a.accountId} — {a.scopes.length} scopes
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={linearMode === "read_write"}
              onChange={() => setLinearMode("read_write")}
              disabled={disabled || linearConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={linearMode === "read_only"}
              onChange={() => setLinearMode("read_only")}
              disabled={disabled || linearConnected}
            />{" "}
            Read only
          </label>
        </div>
      </IntegrationCard>

      <IntegrationCard
        brandId="notion"
        statusLine={
          notionConnected
            ? `Ready · ${notionAccounts[0]?.workspaceName ?? notionAccounts[0]?.email ?? "workspace linked"}`
            : INTEGRATION_BRANDS.notion.tagline
        }
        connected={notionConnected}
        expanded={expanded === "notion"}
        onToggle={() => toggleExpand("notion")}
        primaryLabel={notionConnected ? "Disconnect" : "Connect"}
        primaryDanger={notionConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(notionPrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Notion and pick pages to share so your agent can search, read, and update docs (with approval).
        </p>
        {notionAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.workspaceName ?? a.accountId} — {a.scopes.length} scopes
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={notionMode === "read_write"}
              onChange={() => setNotionMode("read_write")}
              disabled={disabled || notionConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={notionMode === "read_only"}
              onChange={() => setNotionMode("read_only")}
              disabled={disabled || notionConnected}
            />{" "}
            Read only
          </label>
        </div>
      </IntegrationCard>

      <IntegrationCard
        brandId="github"
        statusLine={
          githubConnected
            ? `Ready · ${githubToolCount} tools for your agent`
            : githubAccounts.length > 0
              ? `Signed in — tap Enable tools`
              : INTEGRATION_BRANDS.github.tagline
        }
        connected={githubConnected}
        expanded={expanded === "github"}
        onToggle={() => toggleExpand("github")}
        primaryLabel={githubConnected ? "Disconnect" : githubAccounts.length > 0 ? "Enable tools" : "Connect"}
        primaryDanger={githubConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(githubPrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with GitHub so your agent can browse repos, issues, and pull requests.
        </p>
        {githubAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.login ?? a.email ?? a.accountId} — {a.scopes.length} scopes
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={githubMode === "read_write"}
              onChange={() => setGithubMode("read_write")}
              disabled={disabled || githubConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={githubMode === "read_only"}
              onChange={() => setGithubMode("read_only")}
              disabled={disabled || githubConnected}
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
            disabled={disabled || !githubConnected && githubAccounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/github?revoke=1", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "revoke failed");
              })
            }
          >
            Revoke GitHub access
          </button>
        </div>
      </IntegrationCard>

      <IntegrationCard
        brandId="advanced"
        statusLine={
          customMcp.length + openApi.length > 0
            ? `${customMcp.length + openApi.length} custom connection${customMcp.length + openApi.length === 1 ? "" : "s"}`
            : INTEGRATION_BRANDS.advanced.tagline
        }
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
      </IntegrationCard>
      </div>
    </div>
  );
}
