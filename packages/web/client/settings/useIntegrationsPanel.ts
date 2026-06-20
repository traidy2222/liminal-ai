import { useCallback, useEffect, useMemo, useState } from "react";
import { webApiFetch } from "../webApiAuth.js";
import type {
  AuthKind,
  IntegrationsData,
  IntegrationExpandedId,
  ReadWriteMode,
} from "./integrationsTypes.js";

function toolsConnected(d: IntegrationsData, parentProvider: string) {
  return d.connections.some((c) => c.parentProvider === parentProvider);
}

export function buildAuth(kind: AuthKind, envVar: string, headerName: string) {
  if (kind === "none" || !envVar.trim()) return { kind: "none" as const };
  if (kind === "header") {
    return { kind, envVar: envVar.trim(), headerName: headerName.trim() || "Authorization" };
  }
  return { kind, envVar: envVar.trim() };
}

export function useIntegrationsPanel(agentBusy: boolean) {
  const [data, setData] = useState<IntegrationsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<IntegrationExpandedId>(null);

  const [mode, setMode] = useState<ReadWriteMode>("read_write");
  const [msMode, setMsMode] = useState<ReadWriteMode>("read_write");
  const [azureMode, setAzureMode] = useState<ReadWriteMode>("read_write");
  const [awsMode, setAwsMode] = useState<ReadWriteMode>("read_write");
  const [xeroMode, setXeroMode] = useState<ReadWriteMode>("read_write");
  const [xeroExtended, setXeroExtended] = useState(false);
  const [xeroFullScopes, setXeroFullScopes] = useState(false);
  const [slackMode, setSlackMode] = useState<ReadWriteMode>("read_write");
  const [linearMode, setLinearMode] = useState<ReadWriteMode>("read_write");
  const [notionMode, setNotionMode] = useState<ReadWriteMode>("read_write");
  const [youtubeMode, setYoutubeMode] = useState<ReadWriteMode>("read_write");
  const [youtubeMonetary, setYoutubeMonetary] = useState(false);
  const [githubMode, setGithubMode] = useState<ReadWriteMode>("read_write");
  const [idaMode, setIdaMode] = useState<ReadWriteMode>("read_write");
  const [idaMcpUrlOverride, setIdaMcpUrlOverride] = useState("");
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set());
  const [msSelectedServices, setMsSelectedServices] = useState<Set<string>>(new Set());

  const [mcpName, setMcpName] = useState("");
  const [mcpUrl, setMcpUrl] = useState("");
  const [mcpReadOnly, setMcpReadOnly] = useState(false);
  const [mcpAuthKind, setMcpAuthKind] = useState<AuthKind>("none");
  const [mcpAuthEnv, setMcpAuthEnv] = useState("");
  const [mcpAuthHeader, setMcpAuthHeader] = useState("Authorization");

  const [apiName, setApiName] = useState("");
  const [apiSpecUrl, setApiSpecUrl] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [apiAuthKind, setApiAuthKind] = useState<AuthKind>("bearer");
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
      if (selectedServices.size === 0) {
        const defaults =
          json.google.defaultServices?.length > 0
            ? json.google.defaultServices
            : json.google.services.length > 0
              ? ["gmail", "calendar"]
              : [];
        if (defaults.length > 0) setSelectedServices(new Set(defaults));
      }
      if (msSelectedServices.size === 0) {
        const msDefaults =
          json.microsoft?.defaultServices?.length
            ? json.microsoft.defaultServices
            : json.microsoft?.services.length
              ? ["mail", "calendar"]
              : [];
        if (msDefaults.length > 0) setMsSelectedServices(new Set(msDefaults));
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

  const pollIntegrationsUntil = useCallback(
    async (predicate: (d: IntegrationsData) => boolean, timeoutMs = 10 * 60_000) => {
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
    },
    []
  );

  const run = useCallback(
    async (fn: () => Promise<void>) => {
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
    },
    [load]
  );

  const toggleService = useCallback((id: string) => {
    setSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const applyGooglePreset = useCallback((services: string[]) => {
    setSelectedServices(new Set(services));
  }, []);

  const applyMicrosoftPreset = useCallback((services: string[]) => {
    setMsSelectedServices(new Set(services));
  }, []);

  const toggleMsService = useCallback((id: string) => {
    setMsSelectedServices((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleExpand = useCallback((id: IntegrationExpandedId) => {
    setExpanded((prev) => (prev === id ? null : id));
  }, []);

  const derived = useMemo(() => {
    const connections = data?.connections ?? [];
    const curatedParents = new Set(["google_workspace", "microsoft_365", "azure", "aws", "github", "ida"]);
    const googleMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "google_workspace");
    const microsoftMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "microsoft_365");
    const azureMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "azure");
    const awsMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "aws");
    const githubMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "github");
    const idaMcp = connections.filter((c) => c.kind === "mcp" && c.parentProvider === "ida");
    const msGraphConn = microsoftMcp.find((c) => c.name === "microsoft");

    const accounts = data?.google.accounts ?? [];
    const msAccounts = data?.microsoft?.accounts ?? [];
    const azureAccounts = data?.azure?.accounts ?? [];
    const awsAccounts = data?.aws?.accounts ?? [];
    const githubAccounts = data?.github?.accounts ?? [];
    const xeroAccounts = data?.xero?.accounts ?? [];
    const slackAccounts = data?.slack?.accounts ?? [];
    const linearAccounts = data?.linear?.accounts ?? [];
    const notionAccounts = data?.notion?.accounts ?? [];
    const youtubeAccounts = data?.youtube?.accounts ?? [];

    const providerStatus = data?.providerStatus;
    return {
      connections,
      curatedParents,
      customMcp: connections.filter(
        (c) => c.kind === "mcp" && (!c.parentProvider || !curatedParents.has(c.parentProvider))
      ),
      openApi: connections.filter((c) => c.kind === "openapi"),
      googleMcp,
      microsoftMcp,
      azureMcp,
      awsMcp,
      githubMcp,
      idaMcp,
      idaSidecar: data?.ida?.sidecar,
      idaEnabled: data?.ida?.enabled ?? false,
      idaGuiReachable: data?.ida?.guiReachable ?? false,
      googleCalendarAttached: googleMcp.some((c) => c.name === "google_calendar"),
      msCalendarAttached: msGraphConn?.services?.includes("calendar") ?? false,
      accounts,
      sidecar: data?.google.sidecar,
      services: data?.google.services ?? [],
      googleServiceGroups: data?.google.serviceGroups ?? [],
      googleConnectPresets: data?.google.connectPresets ?? [],
      msAccounts,
      msSidecar: data?.microsoft?.sidecar,
      msServices: data?.microsoft?.services ?? [],
      msServiceGroups: data?.microsoft?.serviceGroups ?? [],
      msConnectPresets: data?.microsoft?.connectPresets ?? [],
      azureAccounts,
      azureSidecar: data?.azure?.sidecar,
      awsAccounts,
      awsSidecar: data?.aws?.sidecar,
      xeroAccounts,
      slackAccounts,
      linearAccounts,
      notionAccounts,
      youtubeAccounts,
      githubAccounts,
      googleConnected: providerStatus?.google?.ready ?? googleMcp.length > 0,
      microsoftConnected: providerStatus?.microsoft?.ready ?? microsoftMcp.length > 0,
      googleReady: providerStatus?.google?.ready ?? false,
      microsoftReady: providerStatus?.microsoft?.ready ?? false,
      googleMcpAttached: googleMcp.length > 0,
      microsoftMcpAttached: microsoftMcp.length > 0,
      azureConnected: azureMcp.length > 0,
      awsConnected: awsMcp.length > 0,
      githubConnected: githubMcp.length > 0,
      idaConnected: idaMcp.length > 0,
      xeroConnected: xeroAccounts.length > 0,
      xeroNeedsReconnect: xeroAccounts.some((a) => (a.missingScopes?.length ?? 0) > 0),
      slackConnected: slackAccounts.length > 0,
      linearConnected: linearAccounts.length > 0,
      notionConnected: notionAccounts.length > 0,
      youtubeConnected: youtubeAccounts.length > 0,
      youtubeNeedsReconnect: youtubeAccounts.some((a) => (a.missingScopes?.length ?? 0) > 0),
      googleToolCount: googleMcp.reduce((n, c) => n + c.toolCount, 0),
      microsoftToolCount: microsoftMcp.reduce((n, c) => n + c.toolCount, 0),
      azureToolCount: azureMcp.reduce((n, c) => n + c.toolCount, 0),
      awsToolCount: awsMcp.reduce((n, c) => n + c.toolCount, 0),
      githubToolCount: githubMcp.reduce((n, c) => n + c.toolCount, 0),
      idaToolCount: idaMcp.reduce((n, c) => n + c.toolCount, 0),
      googleSignedIn: providerStatus?.google?.signedIn ?? accounts.length > 0,
      microsoftSignedIn: providerStatus?.microsoft?.signedIn ?? msAccounts.length > 0,
      azureSignedIn: providerStatus?.azure?.signedIn ?? azureAccounts.length > 0,
      awsSignedIn: providerStatus?.aws?.signedIn ?? awsAccounts.length > 0,
      githubSignedIn: providerStatus?.github?.signedIn ?? githubAccounts.length > 0,
      idaSignedIn: providerStatus?.ida?.signedIn ?? (data?.ida?.enabled && (data?.ida?.sidecar?.running || data?.ida?.guiReachable)) ?? false,
      googleServiceCards: data?.serviceCards?.google ?? [],
      microsoftServiceCards: data?.serviceCards?.microsoft ?? [],
      awsServiceCards: data?.serviceCards?.aws ?? [],
    };
  }, [data]);

  const disabled = busy || agentBusy || loading;

  const revokeAccount = useCallback(
    async (provider: string, accountId: string) => {
      const res = await webApiFetch(
        `/api/integrations/${encodeURIComponent(provider)}/accounts/${encodeURIComponent(accountId)}`,
        { method: "DELETE" }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to remove account");
      await load();
    },
    [load]
  );

  function findServiceCard(
    d: IntegrationsData,
    vendor: "google" | "microsoft" | "azure",
    serviceId: string
  ) {
    if (vendor === "google") {
      return d.serviceCards?.google.find((c) => c.serviceId === serviceId);
    }
    return d.serviceCards?.microsoft.find(
      (c) =>
        c.serviceId === serviceId &&
        (vendor === "azure" ? c.vendor === "azure" : c.vendor === "microsoft")
    );
  }

  const connectWorkspaceService = useCallback(
    async (vendor: "google" | "microsoft" | "azure", serviceId: string) => {
      const rwMode = vendor === "google" ? mode : vendor === "microsoft" ? msMode : azureMode;
      const apiRoot = vendor === "azure" ? "azure" : vendor === "google" ? "google" : "microsoft";
      const snap = data ?? ({} as IntegrationsData);
      const card = findServiceCard(snap, vendor, serviceId);

      if (!card?.signedIn || card.needsScopeReconnect) {
        const res = await webApiFetch(
          `/api/integrations/${apiRoot}/begin?mode=${rwMode}&services=${encodeURIComponent(serviceId)}`
        );
        if (!res.ok) throw new Error(await res.text());
        const { connectUrl } = (await res.json()) as { connectUrl: string };
        window.open(connectUrl, "_blank", "noopener,noreferrer");
        await pollIntegrationsUntil((d) => {
          const c = findServiceCard(d, vendor, serviceId);
          return Boolean(c?.signedIn) && !c?.needsScopeReconnect;
        });
      }

      if (!findServiceCard(data ?? snap, vendor, serviceId)?.connected) {
        const res = await webApiFetch(`/api/integrations/${apiRoot}/connect`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ services: [serviceId], mode: rwMode }),
        });
        const json = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(json.error ?? "connect failed");
        await pollIntegrationsUntil((d) => findServiceCard(d, vendor, serviceId)?.connected ?? false);
      }
    },
    [azureMode, data, mode, msMode, pollIntegrationsUntil]
  );

  const connectGoogleService = useCallback(
    (serviceId: string) => connectWorkspaceService("google", serviceId),
    [connectWorkspaceService]
  );
  const connectMicrosoftService = useCallback(
    (serviceId: string) => connectWorkspaceService("microsoft", serviceId),
    [connectWorkspaceService]
  );
  const connectAzureService = useCallback(
    (serviceId: string) => connectWorkspaceService("azure", serviceId),
    [connectWorkspaceService]
  );

  const connectAwsService = useCallback(
    async (serviceId: string) => {
      const res = await webApiFetch("/api/integrations/aws/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: [serviceId], mode: awsMode }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "connect failed");
      await pollIntegrationsUntil((d) =>
        Boolean(d.serviceCards?.aws.find((c) => c.serviceId === serviceId)?.connected)
      );
    },
    [awsMode, pollIntegrationsUntil]
  );

  const googlePrimary = useCallback(async () => {
    const { googleConnected, accounts, googleReady } = derived;
    const connectIfNeeded = async () => {
      if (toolsConnected(data ?? ({} as IntegrationsData), "google_workspace")) return;
      const res = await webApiFetch("/api/integrations/google/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: [...selectedServices], mode }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "connect failed");
      await pollIntegrationsUntil((d) => toolsConnected(d, "google_workspace") || (d.providerStatus?.google?.ready ?? false));
    };
    if (googleConnected || googleReady) {
      const svc = [...selectedServices].join(",");
      const res = await webApiFetch(
        `/api/integrations/google/begin?mode=${mode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
      );
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      const before = accounts.length;
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.google?.accounts.length ?? 0) > before);
      await connectIfNeeded();
      return;
    }
    const svc = [...selectedServices].join(",");
    const res = await webApiFetch(
      `/api/integrations/google/begin?mode=${mode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
    );
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.google?.accounts.length ?? 0) > 0);
    await connectIfNeeded();
  }, [derived, mode, pollIntegrationsUntil, selectedServices, data]);

  const microsoftPrimary = useCallback(async () => {
    const { microsoftConnected, msAccounts, microsoftReady } = derived;
    const connectIfNeeded = async () => {
      if (toolsConnected(data ?? ({} as IntegrationsData), "microsoft_365")) return;
      const res = await webApiFetch("/api/integrations/microsoft/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ services: [...msSelectedServices], mode: msMode }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "connect failed");
      await pollIntegrationsUntil(
        (d) => toolsConnected(d, "microsoft_365") || (d.providerStatus?.microsoft?.ready ?? false)
      );
    };
    if (microsoftConnected || microsoftReady) {
      const svc = [...msSelectedServices].join(",");
      const res = await webApiFetch(
        `/api/integrations/microsoft/begin?mode=${msMode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
      );
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      const before = msAccounts.length;
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.microsoft?.accounts.length ?? 0) > before);
      await connectIfNeeded();
      return;
    }
    const svc = [...msSelectedServices].join(",");
    const res = await webApiFetch(
      `/api/integrations/microsoft/begin?mode=${msMode}${svc ? `&services=${encodeURIComponent(svc)}` : ""}`
    );
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.microsoft?.accounts.length ?? 0) > 0);
    await connectIfNeeded();
  }, [derived, msMode, msSelectedServices, pollIntegrationsUntil, data]);

  const azurePrimary = useCallback(async () => {
    const { azureConnected, azureAccounts } = derived;
    if (azureConnected) {
      const res = await webApiFetch(`/api/integrations/azure/begin?mode=${azureMode}`);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      const before = azureAccounts.length;
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.azure?.accounts.length ?? 0) > before);
      return;
    }
    if (azureAccounts.length === 0) {
      const res = await webApiFetch(`/api/integrations/azure/begin?mode=${azureMode}`);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => toolsConnected(d, "azure"));
      return;
    }
    const res = await webApiFetch("/api/integrations/azure/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: azureMode }),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "connect failed");
  }, [azureMode, derived, pollIntegrationsUntil]);

  const githubPrimary = useCallback(async () => {
    const { githubConnected, githubAccounts } = derived;
    if (githubConnected) {
      const res = await webApiFetch(`/api/integrations/github/begin?mode=${githubMode}`);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      const before = githubAccounts.length;
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.github?.accounts.length ?? 0) > before);
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
      (d) => toolsConnected(d, "github") || (d.github?.accounts.length ?? 0) > 0
    );
  }, [derived, githubMode, pollIntegrationsUntil]);

  const idaPrimary = useCallback(async () => {
    const { idaConnected } = derived;
    if (idaConnected) {
      const res = await webApiFetch("/api/integrations/ida", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "IDA disconnect failed");
      return;
    }
    const body: { mode?: string; mcp_url?: string } = { mode: idaMode };
    const url = idaMcpUrlOverride.trim() || data?.ida?.mcpUrlOverride?.trim();
    if (url) body.mcp_url = url;
    const res = await webApiFetch("/api/integrations/ida/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(json.error ?? "IDA connect failed");
  }, [data?.ida?.mcpUrlOverride, derived, idaMode, idaMcpUrlOverride]);

  const beginXeroOAuth = useCallback(async () => {
    const qs = new URLSearchParams({ mode: xeroMode });
    if (xeroExtended) qs.set("extended", "1");
    if (xeroFullScopes) qs.set("full_scopes", "1");
    const res = await webApiFetch(`/api/integrations/xero/begin?${qs.toString()}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.xero?.accounts.length ?? 0) > 0);
  }, [pollIntegrationsUntil, xeroExtended, xeroFullScopes, xeroMode]);

  const xeroReconnect = useCallback(async () => {
    if (derived.xeroConnected) {
      const res = await webApiFetch("/api/integrations/xero?revoke=1", { method: "DELETE" });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "disconnect failed");
    }
    await beginXeroOAuth();
  }, [beginXeroOAuth, derived.xeroConnected]);

  const xeroPrimary = useCallback(async () => {
    if (derived.xeroNeedsReconnect) {
      await xeroReconnect();
      return;
    }
    if (derived.xeroConnected) {
      const before = data?.xero?.accounts.length ?? 0;
      await beginXeroOAuth();
      await pollIntegrationsUntil((d) => (d.xero?.accounts.length ?? 0) > before);
      return;
    }
    await beginXeroOAuth();
  }, [
    beginXeroOAuth,
    data?.xero?.accounts.length,
    derived.xeroConnected,
    derived.xeroNeedsReconnect,
    pollIntegrationsUntil,
    xeroReconnect,
  ]);

  const slackPrimary = useCallback(async () => {
    const before = data?.slack?.accounts.length ?? 0;
    if (derived.slackConnected) {
      const res = await webApiFetch(`/api/integrations/slack/begin?mode=${slackMode}`);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.slack?.accounts.length ?? 0) > before);
      return;
    }
    const res = await webApiFetch(`/api/integrations/slack/begin?mode=${slackMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.slack?.accounts.length ?? 0) > 0);
  }, [data?.slack?.accounts.length, derived.slackConnected, pollIntegrationsUntil, slackMode]);

  const linearPrimary = useCallback(async () => {
    const before = data?.linear?.accounts.length ?? 0;
    if (derived.linearConnected) {
      const res = await webApiFetch(`/api/integrations/linear/begin?mode=${linearMode}`);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.linear?.accounts.length ?? 0) > before);
      return;
    }
    const res = await webApiFetch(`/api/integrations/linear/begin?mode=${linearMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.linear?.accounts.length ?? 0) > 0);
  }, [data?.linear?.accounts.length, derived.linearConnected, linearMode, pollIntegrationsUntil]);

  const notionPrimary = useCallback(async () => {
    const before = data?.notion?.accounts.length ?? 0;
    if (derived.notionConnected) {
      const res = await webApiFetch(`/api/integrations/notion/begin?mode=${notionMode}`);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.notion?.accounts.length ?? 0) > before);
      return;
    }
    const res = await webApiFetch(`/api/integrations/notion/begin?mode=${notionMode}`);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.notion?.accounts.length ?? 0) > 0);
  }, [data?.notion?.accounts.length, derived.notionConnected, notionMode, pollIntegrationsUntil]);

  const youtubePrimary = useCallback(async () => {
    const before = data?.youtube?.accounts.length ?? 0;
    const qs = new URLSearchParams({ mode: youtubeMode });
    if (youtubeMonetary) qs.set("monetary", "1");
    const beginUrl = `/api/integrations/youtube/begin?${qs.toString()}`;
    if (derived.youtubeConnected) {
      const res = await webApiFetch(beginUrl);
      if (!res.ok) throw new Error(await res.text());
      const { connectUrl } = (await res.json()) as { connectUrl: string };
      window.open(connectUrl, "_blank", "noopener,noreferrer");
      await pollIntegrationsUntil((d) => (d.youtube?.accounts.length ?? 0) > before);
      return;
    }
    const res = await webApiFetch(beginUrl);
    if (!res.ok) throw new Error(await res.text());
    const { connectUrl } = (await res.json()) as { connectUrl: string };
    window.open(connectUrl, "_blank", "noopener,noreferrer");
    await pollIntegrationsUntil((d) => (d.youtube?.accounts.length ?? 0) > 0);
  }, [
    data?.youtube?.accounts.length,
    derived.youtubeConnected,
    pollIntegrationsUntil,
    youtubeMode,
    youtubeMonetary,
  ]);

  return {
    data,
    loading,
    busy,
    error,
    expanded,
    disabled,
    derived,
    modes: {
      mode,
      setMode,
      msMode,
      setMsMode,
      azureMode,
      setAzureMode,
      awsMode,
      setAwsMode,
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
    },
    services: {
      selectedServices,
      msSelectedServices,
      toggleService,
      toggleMsService,
      applyGooglePreset,
      applyMicrosoftPreset,
    },
    advanced: {
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
    },
    actions: {
      load,
      run,
      toggleExpand,
      googlePrimary,
      microsoftPrimary,
      azurePrimary,
      githubPrimary,
      idaPrimary,
      xeroPrimary,
      xeroReconnect,
      slackPrimary,
      linearPrimary,
      notionPrimary,
      youtubePrimary,
      revokeAccount,
      connectGoogleService,
      connectMicrosoftService,
      connectAzureService,
      connectAwsService,
    },
  };
}

export type IntegrationsPanelController = ReturnType<typeof useIntegrationsPanel>;
