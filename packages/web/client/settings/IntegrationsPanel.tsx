import React from "react";
import { webApiFetch } from "../webApiAuth.js";
import { INTEGRATION_BRANDS } from "./integrationBrands.js";
import { IntegrationAccountsList } from "./IntegrationAccountsList.js";
import { IntegrationCard } from "./IntegrationCard.js";
import { buildAuth, useIntegrationsPanel } from "./useIntegrationsPanel.js";

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

export interface IntegrationsPanelProps {
  agentBusy: boolean;
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 4 }}>{children}</div>;
}

export function IntegrationsPanel({ agentBusy }: IntegrationsPanelProps) {
  const ctrl = useIntegrationsPanel(agentBusy);
  const {
    data,
    loading,
    busy,
    error,
    expanded,
    disabled,
    derived: d,
    modes: m,
    services: svc,
    advanced: adv,
    actions,
  } = ctrl;

  const {
    accounts,
    sidecar,
    services,
    msAccounts,
    msSidecar,
    msServices,
    azureAccounts,
    azureSidecar,
    xeroAccounts,
    slackAccounts,
    linearAccounts,
    notionAccounts,
    youtubeAccounts,
    githubAccounts,
    googleConnected,
    microsoftConnected,
    azureConnected,
    xeroConnected,
    slackConnected,
    linearConnected,
    notionConnected,
    youtubeConnected,
    youtubeNeedsReconnect,
    githubConnected,
    googleToolCount,
    microsoftToolCount,
    azureToolCount,
    githubToolCount,
    googleSignedIn,
    microsoftSignedIn,
    azureSignedIn,
    githubSignedIn,
    googleCalendarAttached,
    msCalendarAttached,
    customMcp,
    openApi,
  } = d;

  const { run, toggleExpand } = actions;
  const { toggleService, toggleMsService } = svc;
  const {
    googlePrimary,
    microsoftPrimary,
    azurePrimary,
    githubPrimary,
    xeroPrimary,
    xeroReconnect,
    slackPrimary,
    linearPrimary,
    notionPrimary,
    youtubePrimary,
    revokeAccount,
    load,
  } = actions;

  const {
    mode,
    setMode,
    msMode,
    setMsMode,
    azureMode,
    setAzureMode,
    xeroMode,
    setXeroMode,
    xeroExtended,
    setXeroExtended,
    xeroFullScopes,
    setXeroFullScopes,
    slackMode,
    setSlackMode,
    linearMode,
    setLinearMode,
    notionMode,
    setNotionMode,
    youtubeMode,
    setYoutubeMode,
    youtubeMonetary,
    setYoutubeMonetary,
    githubMode,
    setGithubMode,
  } = m;
  const { selectedServices, msSelectedServices } = svc;
  const {
    mcpName,
    setMcpName,
    mcpUrl,
    setMcpUrl,
    mcpReadOnly,
    setMcpReadOnly,
    mcpAuthKind,
    setMcpAuthKind,
    mcpAuthEnv,
    setMcpAuthEnv,
    mcpAuthHeader,
    setMcpAuthHeader,
    apiName,
    setApiName,
    apiSpecUrl,
    setApiSpecUrl,
    apiBaseUrl,
    setApiBaseUrl,
    apiAuthKind,
    setApiAuthKind,
    apiAuthEnv,
    setApiAuthEnv,
    apiAuthHeader,
    setApiAuthHeader,
  } = adv;

  return (
    <div style={{ paddingBottom: 16 }}>
      <div style={{ fontSize: 11, color: AMBER, fontWeight: 700, letterSpacing: "0.06em", marginBottom: 8 }}>
        INTEGRATIONS
      </div>
      <p style={{ fontSize: 12, color: "#aab8c4", lineHeight: 1.5, marginBottom: 14 }}>
        Connect apps your agent can use. Workspace providers (Google, Microsoft, Azure) are two steps: sign in with
        OAuth, then enable tools for the agent. Slack, Linear, and others attach tools automatically after sign-in. Tap a
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
        statusMode="oauth_mcp"
        signedIn={googleSignedIn}
        toolsAttached={googleConnected}
        expanded={expanded === "google"}
        onToggle={() => toggleExpand("google")}
        primaryLabel={
          googleConnected ? "Add account" : accounts.length > 0 ? "Enable tools" : "Connect"
        }
        primaryDanger={false}
        primaryDisabled={disabled}
        onPrimary={() => void run(googlePrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Sign in with Google to let your agent read and send email, manage calendar events, and work with Drive files.
        </p>
        <IntegrationAccountsList
          accounts={accounts.map((a) => ({
            accountId: a.accountId,
            label: a.email ?? a.accountId,
            meta:
              (a.missingScopes?.length ?? 0) > 0
                ? `${a.scopes.length} scopes · missing scopes`
                : `${a.scopes.length} scopes`,
          }))}
          disabled={disabled}
          onRemove={(id) => run(() => revokeAccount("google", id))}
          onDisconnectAll={() =>
            run(async () => {
              const res = await webApiFetch("/api/integrations/google?revoke=1", { method: "DELETE" });
              const json = (await res.json()) as { error?: string };
              if (!res.ok) throw new Error(json.error ?? "revoke failed");
              await load();
            })
          }
        />
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
                await load();
              })
            }
          >
            Re-attach tools
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
        statusMode="oauth_mcp"
        signedIn={microsoftSignedIn}
        toolsAttached={microsoftConnected}
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
        brandId="azure"
        statusLine={
          azureConnected
            ? `Ready · ${azureToolCount} MCP tools`
            : azureAccounts.length > 0
              ? `Signed in — tap Connect`
              : INTEGRATION_BRANDS.azure.tagline
        }
        connected={azureConnected || azureAccounts.length > 0}
        statusMode="oauth_mcp"
        signedIn={azureSignedIn}
        toolsAttached={azureConnected}
        expanded={expanded === "azure"}
        onToggle={() => toggleExpand("azure")}
        primaryLabel={azureConnected ? "Disconnect" : "Connect"}
        primaryDanger={azureConnected}
        primaryDisabled={disabled}
        onPrimary={() => void run(azurePrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          ARM REST + @azure/mcp sidecar. Run <code style={{ fontFamily: "monospace" }}>az login</code> for full MCP
          coverage.
        </p>
        {azureAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.email ?? a.accountId} — {a.scopes.length} scopes
            {(a.missingScopes?.length ?? 0) > 0 ? (
              <span style={{ color: AMBER }}> · missing scopes — revoke & reconnect</span>
            ) : null}
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={azureMode === "read_write"}
              onChange={() => setAzureMode("read_write")}
              disabled={disabled || azureConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={azureMode === "read_only"}
              onChange={() => setAzureMode("read_only")}
              disabled={disabled || azureConnected}
            />{" "}
            Read only
          </label>
        </div>
        {azureSidecar ? (
          <div
            style={{
              fontSize: 10,
              fontFamily: "monospace",
              color: azureSidecar.running ? GREEN : AMBER,
              marginBottom: 10,
            }}
          >
            Azure MCP sidecar: {azureSidecar.running ? azureSidecar.url : "stopped"}
          </div>
        ) : null}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={{ ...btn, fontSize: 10, padding: "6px 10px" }}
            disabled={disabled || azureAccounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/azure/connect", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ mode: azureMode }),
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
            disabled={disabled || azureAccounts.length === 0}
            onClick={() =>
              void run(async () => {
                const res = await webApiFetch("/api/integrations/azure?revoke=1", { method: "DELETE" });
                const json = (await res.json()) as { error?: string };
                if (!res.ok) throw new Error(json.error ?? "revoke failed");
              })
            }
          >
            Revoke Azure access
          </button>
        </div>
      </IntegrationCard>

      <IntegrationCard
        brandId="xero"
        statusLine={
          xeroConnected
            ? (xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0
              ? `Reconnect needed · ${xeroAccounts[0]?.missingCoreScopes?.length} core scopes missing`
              : (xeroAccounts[0]?.missingFullScopes?.length ?? 0) > 0
                ? `Connected · enable Full accounting scopes + reconnect for reports/budgets`
                : (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0
                  ? `Accounting ready · enable Extended APIs + reconnect for files/projects/payroll`
                  : `Ready · ${xeroAccounts[0]?.tenantName ?? xeroAccounts[0]?.email ?? "account linked"}`
            : INTEGRATION_BRANDS.xero.tagline
        }
        connected={xeroConnected}
        statusMode="oauth_auto_attach"
        signedIn={xeroConnected}
        expanded={expanded === "xero"}
        onToggle={() => toggleExpand("xero")}
        primaryLabel={
          xeroConnected &&
          ((xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0 ||
            (xeroFullScopes && (xeroAccounts[0]?.missingFullScopes?.length ?? 0) > 0) ||
            (xeroExtended && (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0))
            ? "Reconnect"
            : xeroConnected
              ? "Disconnect"
              : "Connect"
        }
        primaryDanger={
          xeroConnected &&
          (xeroAccounts[0]?.missingCoreScopes?.length ?? 0) === 0 &&
          !(xeroFullScopes && (xeroAccounts[0]?.missingFullScopes?.length ?? 0) > 0) &&
          !(xeroExtended && (xeroAccounts[0]?.missingExtendedScopes?.length ?? 0) > 0)
        }
        primaryDisabled={disabled}
        onPrimary={() =>
          void run(
            xeroConnected &&
              ((xeroAccounts[0]?.missingCoreScopes?.length ?? 0) > 0 ||
                (xeroFullScopes && (xeroAccounts[0]?.missingFullScopes?.length ?? 0) > 0) ||
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
            Core accounting scopes are missing. Click <strong>Reconnect</strong> (leave Extended APIs off).
          </p>
        ) : (xeroAccounts[0]?.missingFullScopes?.length ?? 0) > 0 ? (
          <p style={{ fontSize: 11, color: "#e6b84d", lineHeight: 1.45, margin: "0 0 10px" }}>
            Basic connect succeeded. For reports and budgets: check <strong>Full accounting scopes</strong>,
            then <strong>Reconnect</strong>.
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
            checked={xeroFullScopes}
            onChange={(e) => setXeroFullScopes(e.target.checked)}
            disabled={disabled || xeroConnected}
          />{" "}
          Full accounting scopes (reports, budgets) — enable after a successful basic connect
        </label>
        <label style={{ display: "block", fontSize: 11, color: "#aabbcc", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={xeroExtended}
            onChange={(e) => setXeroExtended(e.target.checked)}
            disabled={disabled || xeroConnected}
          />{" "}
          Extended APIs (files, projects, payroll) — only if enabled on your Xero app at developer.xero.com
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
            (xeroAccounts[0]?.missingFullScopes?.length ?? 0) > 0 ||
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
        statusMode="oauth_auto_attach"
        signedIn={slackConnected}
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
        statusMode="oauth_auto_attach"
        signedIn={linearConnected}
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
        statusMode="oauth_auto_attach"
        signedIn={notionConnected}
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
        brandId="youtube"
        statusLine={
          youtubeConnected
            ? `Ready · ${youtubeAccounts[0]?.channelTitle ?? youtubeAccounts[0]?.customUrl ?? youtubeAccounts[0]?.email ?? "channel linked"}`
            : INTEGRATION_BRANDS.youtube.tagline
        }
        connected={youtubeConnected}
        statusMode="oauth_auto_attach"
        signedIn={youtubeConnected}
        expanded={expanded === "youtube"}
        onToggle={() => toggleExpand("youtube")}
        primaryLabel={
          youtubeConnected
            ? youtubeNeedsReconnect
              ? "Reconnect"
              : "Disconnect"
            : "Connect"
        }
        primaryDanger={youtubeConnected && !youtubeNeedsReconnect}
        primaryDisabled={disabled}
        onPrimary={() => void run(youtubePrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Connect a YouTube channel separately from Google Workspace — list videos, Studio analytics, and update snippets.
        </p>
        {youtubeNeedsReconnect && (
          <p style={{ fontSize: 11, color: "#e6a23c", margin: "0 0 8px" }}>
            Reconnect to grant analytics scopes (and revenue metrics if you enabled them).
          </p>
        )}
        {youtubeAccounts.map((a) => (
          <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
            {a.channelTitle ?? a.customUrl ?? a.email ?? a.accountId}
            {a.channelId ? ` (${a.channelId})` : ""} — {a.scopes.length} scopes
          </div>
        ))}
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={youtubeMode === "read_write"}
              onChange={() => setYoutubeMode("read_write")}
              disabled={disabled || youtubeConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={youtubeMode === "read_only"}
              onChange={() => setYoutubeMode("read_only")}
              disabled={disabled || youtubeConnected}
            />{" "}
            Read only
          </label>
        </div>
        <label style={{ display: "block", fontSize: 11, color: "#aabbcc", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={youtubeMonetary}
            onChange={(e) => setYoutubeMonetary(e.target.checked)}
            disabled={disabled || youtubeConnected}
          />{" "}
          Include revenue analytics (Partner Program — estimated revenue, ad performance)
        </label>
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
        statusMode="oauth_mcp"
        signedIn={githubSignedIn}
        toolsAttached={githubConnected}
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
