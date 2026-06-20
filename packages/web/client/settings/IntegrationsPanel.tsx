import React from "react";
import { webApiFetch } from "../webApiAuth.js";
import { INTEGRATION_BRANDS } from "./integrationBrands.js";
import { IntegrationAccountsList } from "./IntegrationAccountsList.js";
import { IntegrationCard } from "./IntegrationCard.js";
import {
  IntegrationCategorySection,
  ServiceIntegrationCard,
} from "./ServiceIntegrationCard.js";
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
    advanced: adv,
    actions,
  } = ctrl;

  const {
    accounts,
    msAccounts,
    azureAccounts,
    xeroAccounts,
    slackAccounts,
    linearAccounts,
    notionAccounts,
    youtubeAccounts,
    githubAccounts,
    idaSidecar,
    idaEnabled,
    idaGuiReachable,
    xeroConnected,
    slackConnected,
    linearConnected,
    notionConnected,
    youtubeConnected,
    youtubeNeedsReconnect,
    githubConnected,
    idaConnected,
    idaToolCount,
    githubToolCount,
    githubSignedIn,
    idaSignedIn,
    googleServiceCards,
    microsoftServiceCards,
    customMcp,
    openApi,
  } = d;

  const { run, toggleExpand } = actions;
  const {
    githubPrimary,
    idaPrimary,
    xeroPrimary,
    xeroReconnect,
    slackPrimary,
    linearPrimary,
    notionPrimary,
    youtubePrimary,
    revokeAccount,
    load,
    connectGoogleService,
    connectMicrosoftService,
    connectAzureService,
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
    idaMode,
    setIdaMode,
  } = m;
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
    idaMcpUrlOverride,
    setIdaMcpUrlOverride,
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
        Connect only what you need — each card is one service with its own OAuth scopes. Workspace vendors are grouped
        below; Slack, Linear, Notion, and YouTube are one card each. Tap a card for read/write mode and account options.
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
      <IntegrationCategorySection
        title="Google Workspace"
        subtitle="One Google account — connect Gmail, Calendar, Drive, Docs, and more individually."
        footer={
          expanded === "google-accounts" ? (
            <div>
              <IntegrationAccountsList
                accounts={accounts.map((a) => ({
                  accountId: a.accountId,
                  label: a.email ?? a.accountId,
                  meta: `${a.scopes.length} scopes`,
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
            </div>
          ) : (
            <button
              type="button"
              style={{ ...btn, fontSize: 10, padding: "4px 8px" }}
              onClick={() => toggleExpand("google-accounts")}
            >
              {accounts.length > 0 ? `Google accounts (${accounts.length})` : "Google accounts"}
            </button>
          )
        }
      >
        {googleServiceCards.map((card) => {
          const expandId = `google:${card.serviceId}` as const;
          return (
            <ServiceIntegrationCard
              key={card.serviceId}
              card={{
                vendor: "google",
                serviceId: card.serviceId,
                label: card.label,
                groupLabel: card.groupLabel,
                connected: card.connected,
                signedIn: card.signedIn,
                toolCount: card.toolCount,
                needsScopeReconnect: card.needsScopeReconnect,
                restOnly: card.restOnly,
              }}
              expanded={expanded === expandId}
              disabled={disabled}
              onToggle={() => toggleExpand(expanded === expandId ? null : expandId)}
              onConnect={() => void run(() => connectGoogleService(card.serviceId))}
            >
              <p style={{ fontSize: 10, color: "#778899", margin: "0 0 8px" }}>
                OAuth requests only the scopes for <strong>{card.label}</strong>.
              </p>
              <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
                <input type="radio" checked={mode === "read_write"} onChange={() => setMode("read_write")} disabled={disabled} />{" "}
                Read + write
              </label>
              <label style={{ fontSize: 11, color: "#aabbcc" }}>
                <input type="radio" checked={mode === "read_only"} onChange={() => setMode("read_only")} disabled={disabled} />{" "}
                Read only
              </label>
            </ServiceIntegrationCard>
          );
        })}
      </IntegrationCategorySection>

      <IntegrationCategorySection
        title="Microsoft"
        subtitle="Outlook, Teams, OneDrive, and Azure cloud — each service connects with its own scopes."
        footer={
          expanded === "microsoft-accounts" ? (
            <div>
              {msAccounts.map((a) => (
                <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
                  M365: {a.email ?? a.accountId} — {a.scopes.length} scopes
                </div>
              ))}
              {azureAccounts.map((a) => (
                <div key={a.accountId} style={{ fontSize: 11, fontFamily: "monospace", color: GREEN, marginBottom: 6 }}>
                  Azure: {a.email ?? a.accountId} — {a.scopes.length} scopes
                </div>
              ))}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
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
                  Revoke Microsoft 365
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
                  Revoke Azure
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              style={{ ...btn, fontSize: 10, padding: "4px 8px" }}
              onClick={() => toggleExpand("microsoft-accounts")}
            >
              Microsoft accounts ({msAccounts.length + azureAccounts.length})
            </button>
          )
        }
      >
        {microsoftServiceCards.map((card) => {
          const expandId = (card.vendor === "azure" ? `azure:${card.serviceId}` : `microsoft:${card.serviceId}`) as
            | `azure:${string}`
            | `microsoft:${string}`;
          const rwMode = card.vendor === "azure" ? azureMode : msMode;
          const setRwMode = card.vendor === "azure" ? setAzureMode : setMsMode;
          const onConnect =
            card.vendor === "azure"
              ? () => connectAzureService(card.serviceId)
              : () => connectMicrosoftService(card.serviceId);
          return (
            <ServiceIntegrationCard
              key={`${card.vendor}-${card.serviceId}`}
              card={{
                vendor: card.vendor === "azure" ? "azure" : "microsoft",
                serviceId: card.serviceId,
                label: card.label,
                groupLabel: card.groupLabel,
                connected: card.connected,
                signedIn: card.signedIn,
                toolCount: card.toolCount,
                needsScopeReconnect: card.needsScopeReconnect,
                restOnly: card.restOnly,
              }}
              expanded={expanded === expandId}
              disabled={disabled}
              onToggle={() => toggleExpand(expanded === expandId ? null : expandId)}
              onConnect={() => void run(onConnect)}
            >
              <p style={{ fontSize: 10, color: "#778899", margin: "0 0 8px" }}>
                {card.vendor === "azure"
                  ? "Azure Resource Manager scopes for this capability only."
                  : `Microsoft Graph scopes for ${card.label} only.`}
              </p>
              <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
                <input
                  type="radio"
                  checked={rwMode === "read_write"}
                  onChange={() => setRwMode("read_write")}
                  disabled={disabled}
                />{" "}
                Read + write
              </label>
              <label style={{ fontSize: 11, color: "#aabbcc" }}>
                <input
                  type="radio"
                  checked={rwMode === "read_only"}
                  onChange={() => setRwMode("read_only")}
                  disabled={disabled}
                />{" "}
                Read only
              </label>
            </ServiceIntegrationCard>
          );
        })}
      </IntegrationCategorySection>

      <div
        style={{
          gridColumn: "1 / -1",
          fontSize: 12,
          fontWeight: 700,
          color: "#dde8f0",
          letterSpacing: "0.04em",
          marginTop: 8,
          marginBottom: 4,
        }}
      >
        Collaboration
      </div>

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

      <div
        style={{
          gridColumn: "1 / -1",
          fontSize: 12,
          fontWeight: 700,
          color: "#dde8f0",
          letterSpacing: "0.04em",
          marginTop: 8,
          marginBottom: 4,
        }}
      >
        Developer tools
      </div>

      <IntegrationCard
        brandId="ida"
        statusLine={
          idaConnected
            ? `Ready · ${idaToolCount} tools for your agent`
            : !idaEnabled
              ? "Set AGENT_IDA_MCP=1 in Settings → Harness"
              : idaSignedIn
                ? "Server reachable — tap Connect"
                : idaGuiReachable
                  ? "IDA GUI plugin detected on :13337"
                  : idaSidecar?.running
                    ? `Sidecar on :${idaSidecar.port}`
                    : INTEGRATION_BRANDS.ida.tagline
        }
        connected={idaConnected}
        statusMode="simple"
        signedIn={idaSignedIn}
        toolsAttached={idaConnected}
        expanded={expanded === "ida"}
        onToggle={() => toggleExpand("ida")}
        primaryLabel={idaConnected ? "Disconnect" : "Connect"}
        primaryDanger={idaConnected}
        primaryDisabled={disabled || !idaEnabled}
        onPrimary={() => void run(idaPrimary)}
      >
        <p style={{ fontSize: 11, color: "#778899", lineHeight: 1.45, margin: "10px 0" }}>
          Reverse-engineering via ida-pro-mcp. Headless needs IDA 9.0 SP1+; otherwise start the MCP plugin in IDA
          (Edit → Plugins → MCP) and connect — Liminal auto-falls back to the GUI plugin when reachable.
        </p>
        {idaSidecar && (
          <div style={{ fontSize: 10, color: "#8899aa", marginBottom: 8 }}>
            Sidecar: {idaSidecar.running ? `running ${idaSidecar.url}` : "not running"}
            {idaGuiReachable ? " · GUI plugin :13337 reachable" : ""}
          </div>
        )}
        <FieldLabel>MCP URL override (optional)</FieldLabel>
        <input
          style={{ ...input, marginBottom: 8 }}
          placeholder="http://127.0.0.1:13337/mcp"
          value={idaMcpUrlOverride}
          onChange={(e) => setIdaMcpUrlOverride(e.target.value)}
          disabled={disabled || idaConnected}
        />
        <div style={{ marginBottom: 8 }}>
          <label style={{ fontSize: 11, color: "#aabbcc", marginRight: 12 }}>
            <input
              type="radio"
              checked={idaMode === "read_write"}
              onChange={() => setIdaMode("read_write")}
              disabled={disabled || idaConnected}
            />{" "}
            Read + write
          </label>
          <label style={{ fontSize: 11, color: "#aabbcc" }}>
            <input
              type="radio"
              checked={idaMode === "read_only"}
              onChange={() => setIdaMode("read_only")}
              disabled={disabled || idaConnected}
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

      <div
        style={{
          gridColumn: "1 / -1",
          fontSize: 12,
          fontWeight: 700,
          color: "#dde8f0",
          letterSpacing: "0.04em",
          marginTop: 8,
          marginBottom: 4,
        }}
      >
        Finance
      </div>

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
          Full accounting scopes (reports, budgets)
        </label>
        <label style={{ display: "block", fontSize: 11, color: "#aabbcc", marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={xeroExtended}
            onChange={(e) => setXeroExtended(e.target.checked)}
            disabled={disabled || xeroConnected}
          />{" "}
          Extended APIs (files, projects, payroll)
        </label>
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
