/**
 * Live integration probes for list_connectors — real OAuth/MCP/REST checks,
 * not static Cloud Console checklists.
 */
import {
  getGoogleAccessToken,
  getMicrosoftAccessToken,
  getGoogleServicePreset,
  googleCloudMcpApiLibraryUrl,
  googleProjectIdFromClientId,
  listGoogleOAuthAccounts,
  listMicrosoftOAuthAccounts,
  listGithubOAuthAccounts,
  missingGoogleScopes,
  MICROSOFT_GRAPH_CONNECTION,
  resolveGoogleServices,
  scopesForGoogleServices,
  scopesForMicrosoftServices,
  resolveMicrosoftServices,
  missingMicrosoftScopes,
  type GoogleServiceId,
  type MicrosoftServiceId,
} from "@liminal/core";
import {
  githubOAuthAuthScheme,
  googleOAuthAuthScheme,
  listConnectionsByParent,
  microsoftOAuthAuthScheme,
  type AuthScheme,
} from "./api_connections_store.js";
import { calendarRestEnabled } from "./google_calendar_rest.js";
import { enrichGoogleMcpProbeError, mcpHandshakeAndListTools } from "./mcp_attach.js";
import { getGoogleSidecarStatus } from "./google_sidecar.js";
import { getMicrosoftSidecarStatus } from "./microsoft_sidecar.js";
import { githubAuthAvailable, githubMcpEnabled, githubMcpUrl, githubTokenEnvVar } from "./github_connect.js";
import { formatSlackScopeProbeLine, probeSlackLiveScopes } from "./slack_scope_probe.js";

const GOOGLE_PARENT = "google_workspace";
const MICROSOFT_PARENT = "microsoft_365";
const GITHUB_PARENT = "github";
const PROBE_TIMEOUT_MS = 20_000;

export type GoogleMcpProbeResult =
  | { state: "ok"; toolCount: number }
  | { state: "not_connected"; detail: string }
  | { state: "missing_scopes"; detail: string }
  | { state: "mcp_api_disabled"; detail: string; enableUrl?: string }
  | { state: "not_attached"; detail: string }
  | { state: "error"; detail: string };

export type GoogleRestProbeResult =
  | { state: "ok"; detail?: string }
  | { state: "off"; detail: string }
  | { state: "not_connected"; detail: string }
  | { state: "error"; detail: string };

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms)
    ),
  ]);
}

export async function probeGoogleOfficialMcp(
  serviceId: GoogleServiceId,
  accountId?: string
): Promise<GoogleMcpProbeResult> {
  const preset = getGoogleServicePreset(serviceId);
  if (!preset?.mcpUrl) {
    return { state: "error", detail: `no official MCP URL for ${serviceId}` };
  }

  const accounts = await listGoogleOAuthAccounts();
  if (accounts.length === 0) {
    return { state: "not_connected", detail: "no Google OAuth account on disk" };
  }
  const account = accountId
    ? accounts.find((a) => a.accountId === accountId) ?? accounts[0]!
    : accounts[0]!;
  const granted = account.scopes;
  const group = resolveGoogleServices([serviceId]);
  const miss = missingGoogleScopes(granted, group);
  if (miss.length > 0) {
    return { state: "missing_scopes", detail: `missing scopes: ${miss.join(", ")}` };
  }

  const attached = (await listConnectionsByParent(GOOGLE_PARENT)).some(
    (c) => c.name === preset.connectionName
  );

  const token = await getGoogleAccessToken(account.accountId);
  if (!token) {
    return { state: "not_connected", detail: "OAuth token unreadable (reconnect or fix LIMINAL_OAUTH_KEY)" };
  }

  const mode = "read_write" as const;
  const auth = googleOAuthAuthScheme(account.accountId, scopesForGoogleServices(group, mode));
  try {
    const tools = await withTimeout(mcpHandshakeAndListTools(preset.mcpUrl, auth), PROBE_TIMEOUT_MS);
    if (!attached) {
      return {
        state: "not_attached",
        detail: `API reachable (${tools.length} tools on server) but ${preset.connectionName} not attached — Integrations → Attach Calendar or connect_provider`,
      };
    }
    return { state: "ok", toolCount: tools.length };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const enriched = enrichGoogleMcpProbeError(preset.mcpUrl, raw);
    const attachNote = attached ? "" : ` (also: ${preset.connectionName} not attached)`;
    if (/MCP API has not been used|is disabled/i.test(raw)) {
      const projectId = googleProjectIdFromClientId();
      return {
        state: "mcp_api_disabled",
        detail: enriched + attachNote,
        enableUrl: googleCloudMcpApiLibraryUrl(serviceId, projectId) ?? undefined,
      };
    }
    return { state: "error", detail: enriched + attachNote };
  }
}

export async function probeGoogleCalendarRest(accountId?: string): Promise<GoogleRestProbeResult> {
  if (!calendarRestEnabled()) {
    return { state: "off", detail: "AGENT_GOOGLE_CALENDAR_REST=0" };
  }
  const accounts = await listGoogleOAuthAccounts();
  if (accounts.length === 0) {
    return { state: "not_connected", detail: "no Google OAuth account" };
  }
  const account = accountId
    ? accounts.find((a) => a.accountId === accountId) ?? accounts[0]!
    : accounts[0]!;
  const token = await getGoogleAccessToken(account.accountId);
  if (!token) {
    return { state: "not_connected", detail: "token unreadable" };
  }
  try {
    const res = await withTimeout(
      fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      }),
      PROBE_TIMEOUT_MS
    );
    if (res.status === 403) {
      const body = await res.text();
      if (/API has not been used|accessNotConfigured/i.test(body)) {
        return {
          state: "error",
          detail:
            "Classic Calendar API disabled in Cloud Console (separate from calendarmcp.googleapis.com MCP). Enable calendar.googleapis.com.",
        };
      }
      return { state: "error", detail: `Calendar REST HTTP 403` };
    }
    if (!res.ok) {
      return { state: "error", detail: `Calendar REST HTTP ${res.status}` };
    }
    return { state: "ok" };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

function formatMcpProbeLine(label: string, probe: GoogleMcpProbeResult): string {
  switch (probe.state) {
    case "ok":
      return `- ${label} MCP: **live ok** (${probe.toolCount} tools on server)`;
    case "not_attached":
      return `- ${label} MCP: **not attached** — ${probe.detail}`;
    case "missing_scopes":
      return `- ${label} MCP: **OAuth scopes missing** — ${probe.detail}`;
    case "mcp_api_disabled":
      return (
        `- ${label} MCP: **MCP API not enabled** (classic API may still work via REST)\n` +
        `  ${probe.detail.split("\n").join("\n  ")}` +
        (probe.enableUrl ? `\n  Enable: ${probe.enableUrl}` : "")
      );
    case "not_connected":
      return `- ${label} MCP: **no OAuth** — ${probe.detail}`;
    case "error":
      return `- ${label} MCP: **probe failed** — ${probe.detail}`;
  }
}

function formatRestProbeLine(label: string, probe: GoogleRestProbeResult): string {
  switch (probe.state) {
    case "ok":
      return `- ${label} REST: **live ok** (calendar.googleapis.com)`;
    case "off":
      return `- ${label} REST: off (${probe.detail})`;
    case "not_connected":
      return `- ${label} REST: **no OAuth** — ${probe.detail}`;
    case "error":
      return `- ${label} REST: **probe failed** — ${probe.detail}`;
  }
}

type SidecarProbeResult =
  | { state: "ok"; toolCount: number; url: string }
  | { state: "off"; detail: string }
  | { state: "not_attached"; detail: string }
  | { state: "not_connected"; detail: string }
  | { state: "error"; detail: string };

async function probeSidecarMcp(opts: {
  label: string;
  parentProvider: string;
  connectionName: string;
  getStatus: () => Promise<{ enabled: boolean; running: boolean; url: string }>;
  resolveAuth: () => Promise<AuthScheme | null>;
}): Promise<SidecarProbeResult> {
  const status = await opts.getStatus();
  if (!status.enabled) {
    return { state: "off", detail: "sidecar disabled via env" };
  }
  if (!status.running) {
    return { state: "error", detail: `${opts.label} sidecar not running (${status.url})` };
  }
  const attached = (await listConnectionsByParent(opts.parentProvider)).some(
    (c) => c.name === opts.connectionName
  );
  const auth = await opts.resolveAuth();
  if (!auth) {
    return { state: "not_connected", detail: "no OAuth token for sidecar probe" };
  }
  try {
    const tools = await withTimeout(mcpHandshakeAndListTools(status.url, auth), PROBE_TIMEOUT_MS);
    if (!attached) {
      return {
        state: "not_attached",
        detail: `sidecar reachable (${tools.length} tools) but ${opts.connectionName} not attached in harness`,
      };
    }
    return { state: "ok", toolCount: tools.length, url: status.url };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

export async function probeGoogleExtSidecar(): Promise<SidecarProbeResult> {
  return probeSidecarMcp({
    label: "Google Docs/Sheets",
    parentProvider: GOOGLE_PARENT,
    connectionName: "google_ext",
    getStatus: getGoogleSidecarStatus,
    resolveAuth: async () => {
      const accounts = await listGoogleOAuthAccounts();
      if (accounts.length === 0) return null;
      const accountId = accounts[0]!.accountId;
      const token = await getGoogleAccessToken(accountId);
      if (!token) return null;
      const presets = resolveGoogleServices(["docs", "sheets"]);
      return googleOAuthAuthScheme(accountId, scopesForGoogleServices(presets, "read_write"));
    },
  });
}

export async function probeMicrosoftGraphMcp(): Promise<SidecarProbeResult> {
  return probeSidecarMcp({
    label: "Microsoft Graph",
    parentProvider: MICROSOFT_PARENT,
    connectionName: MICROSOFT_GRAPH_CONNECTION,
    getStatus: getMicrosoftSidecarStatus,
    resolveAuth: async () => {
      const accounts = await listMicrosoftOAuthAccounts();
      if (accounts.length === 0) return null;
      const account = accounts[0]!;
      const token = await getMicrosoftAccessToken(account.accountId);
      if (!token) return null;
      const presets = resolveMicrosoftServices(["mail", "calendar"] as MicrosoftServiceId[]);
      const miss = missingMicrosoftScopes(account.scopes, presets);
      if (miss.length > 0) return null;
      return microsoftOAuthAuthScheme(
        account.accountId,
        scopesForMicrosoftServices(presets, "read_write")
      );
    },
  });
}

export async function probeGithubMcp(): Promise<SidecarProbeResult | { state: "off"; detail: string }> {
  if (!githubMcpEnabled()) {
    return { state: "off", detail: "AGENT_GITHUB_MCP=0" };
  }
  if (!(await githubAuthAvailable())) {
    return { state: "not_connected", detail: "no GitHub OAuth or GITHUB_TOKEN" };
  }
  const attached = (await listConnectionsByParent(GITHUB_PARENT)).some((c) => c.name === "github");
  const envVar = githubTokenEnvVar();
  const envTok = process.env[envVar]?.trim();
  let auth: AuthScheme;
  if (envTok) {
    auth = { kind: "bearer", envVar };
  } else {
    const accounts = await listGithubOAuthAccounts();
    if (accounts.length === 0) {
      return { state: "not_connected", detail: "no GitHub OAuth account" };
    }
    auth = githubOAuthAuthScheme(accounts[0]!.accountId, accounts[0]!.scopes);
  }
  const url = githubMcpUrl();
  try {
    const tools = await withTimeout(mcpHandshakeAndListTools(url, auth), PROBE_TIMEOUT_MS);
    if (!attached) {
      return {
        state: "not_attached",
        detail: `GitHub MCP reachable (${tools.length} tools) but not attached — connect_provider({ provider: "github" })`,
      };
    }
    return { state: "ok", toolCount: tools.length, url };
  } catch (e) {
    return { state: "error", detail: e instanceof Error ? e.message : String(e) };
  }
}

function formatSidecarProbeLine(label: string, probe: SidecarProbeResult): string {
  switch (probe.state) {
    case "ok":
      return `- ${label}: **live ok** (${probe.toolCount} tools @ ${probe.url})`;
    case "not_attached":
      return `- ${label}: **not attached** — ${probe.detail}`;
    case "not_connected":
      return `- ${label}: **no OAuth** — ${probe.detail}`;
    case "off":
      return `- ${label}: off (${probe.detail})`;
    case "error":
      return `- ${label}: **probe failed** — ${probe.detail}`;
  }
}

/** Lines for list_connectors — probes run in parallel with short timeouts. */
export async function buildIntegrationLiveProbeLines(): Promise<string[]> {
  const lines: string[] = ["### Live probes (this session)"];
  try {
    const [gmailMcp, calMcp, calRest, googleExt, msMcp, githubMcp, slackScopes] =
      await Promise.all([
      probeGoogleOfficialMcp("gmail"),
      probeGoogleOfficialMcp("calendar"),
      probeGoogleCalendarRest(),
      probeGoogleExtSidecar(),
      probeMicrosoftGraphMcp(),
      probeGithubMcp(),
      probeSlackLiveScopes(),
    ]);
    lines.push(formatMcpProbeLine("Gmail", gmailMcp));
    lines.push(formatMcpProbeLine("Calendar", calMcp));
    lines.push(formatRestProbeLine("Calendar", calRest));
    lines.push(formatSidecarProbeLine("Google Docs/Sheets (google_ext)", googleExt));
    lines.push(formatSidecarProbeLine("Microsoft Graph MCP", msMcp));
    lines.push(formatSidecarProbeLine("GitHub MCP", githubMcp));
    lines.push(formatSlackScopeProbeLine(slackScopes));
    lines.push(
      "Note: Gmail/Calendar **MCP** (gmailmcp/calendarmcp) and **classic REST** are separate Cloud APIs — one can work while the other is disabled."
    );
  } catch (e) {
    lines.push(`- probe error: ${e instanceof Error ? e.message : String(e)}`);
  }
  return lines;
}

/** @deprecated use buildIntegrationLiveProbeLines */
export async function buildGoogleLiveProbeLines(): Promise<string[]> {
  return buildIntegrationLiveProbeLines();
}
