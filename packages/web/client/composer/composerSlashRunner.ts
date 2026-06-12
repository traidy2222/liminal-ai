import {
  formatRemoteEnableMessage,
  formatRemoteStatusMessage,
  formatSlashHelpText,
  parseComposerSlashSubmit,
  remoteSlashToCommand,
  type ParsedComposerSlash,
} from "@liminal/core";
import { webApiFetch } from "../webApiAuth.js";

export type SlashRunnerResult =
  | { handled: true; message: string; clearInput: true }
  | { handled: true; message: string; clearInput: false }
  | {
      handled: true;
      send: {
        text: string;
        workflowPreset?: "receipt_to_xero";
      };
      clearInput: true;
    }
  | { handled: false };

async function fetchIntegrationsSummary(): Promise<string> {
  const res = await webApiFetch("/api/integrations");
  if (!res.ok) {
    return `Failed to load integrations (${res.status})`;
  }
  const data = (await res.json()) as Record<string, unknown>;
  const parts: string[] = [];
  const push = (label: string, accounts: unknown) => {
    const list = Array.isArray(accounts) ? accounts : [];
    if (list.length === 0) return;
    const first = list[0] as Record<string, unknown>;
    const who =
      String(
        first.teamName ??
          first.organizationName ??
          first.workspaceName ??
          first.login ??
          first.tenantName ??
          first.email ??
          first.accountId ??
          ""
      ) || "connected";
    parts.push(`${label}: ${who}`);
  };
  const google = data.google as { accounts?: unknown[] } | undefined;
  push("Google", google?.accounts);
  const ms = data.microsoft as { accounts?: unknown[] } | undefined;
  push("Microsoft", ms?.accounts);
  push("Xero", (data.xero as { accounts?: unknown[] } | undefined)?.accounts);
  push("Slack", (data.slack as { accounts?: unknown[] } | undefined)?.accounts);
  push("Linear", (data.linear as { accounts?: unknown[] } | undefined)?.accounts);
  push("Notion", (data.notion as { accounts?: unknown[] } | undefined)?.accounts);
  push("GitHub", (data.github as { accounts?: unknown[] } | undefined)?.accounts);
  if (!parts.length) {
    return "No integrations connected. Try /connect xero";
  }
  return parts.join(" · ");
}

async function connectProvider(
  provider: string,
  readOnly: boolean
): Promise<string> {
  const mode = readOnly ? "read_only" : "read_write";
  if (provider === "google") {
    const res = await webApiFetch(
      `/api/integrations/google/begin?mode=${mode}`
    );
    if (!res.ok) throw new Error(`Google connect failed (${res.status})`);
    const body = (await res.json()) as { connectUrl?: string };
    if (body.connectUrl) window.open(body.connectUrl, "_blank", "noopener,noreferrer");
    return "Google: complete sign-in in the browser tab";
  }
  if (provider === "microsoft") {
    const res = await webApiFetch(
      `/api/integrations/microsoft/begin?mode=${mode}`
    );
    if (!res.ok) throw new Error(`Microsoft connect failed (${res.status})`);
    const body = (await res.json()) as { connectUrl?: string };
    if (body.connectUrl) window.open(body.connectUrl, "_blank", "noopener,noreferrer");
    return "Microsoft: complete sign-in in the browser tab";
  }
  const beginPaths: Record<string, string> = {
    xero: `/api/integrations/xero/begin?mode=${mode}`,
    slack: `/api/integrations/slack/begin?mode=${mode}`,
    linear: `/api/integrations/linear/begin?mode=${mode}`,
    notion: `/api/integrations/notion/begin?mode=${mode}`,
    github: `/api/integrations/github/begin?mode=${mode}`,
  };
  const path = beginPaths[provider];
  if (!path) {
    return `Unknown provider "${provider}". Try: slack, linear, notion, xero, github, google, microsoft`;
  }
  const res = await webApiFetch(path);
  if (!res.ok) throw new Error(`Connect failed (${res.status})`);
  const body = (await res.json()) as { connectUrl?: string };
  if (body.connectUrl) window.open(body.connectUrl, "_blank", "noopener,noreferrer");
  return `${provider}: complete sign-in in the browser tab`;
}

async function disconnectProvider(provider: string): Promise<string> {
  const paths: Record<string, string> = {
    google: "/api/integrations/google?revoke=1",
    microsoft: "/api/integrations/microsoft?revoke=1",
    xero: "/api/integrations/xero?revoke=1",
    slack: "/api/integrations/slack?revoke=1",
    linear: "/api/integrations/linear?revoke=1",
    notion: "/api/integrations/notion?revoke=1",
    github: "/api/integrations/github?revoke=1",
  };
  const path = paths[provider];
  if (!path) {
    return `Unknown provider "${provider}"`;
  }
  const res = await webApiFetch(path, { method: "DELETE" });
  if (!res.ok) throw new Error(`Disconnect failed (${res.status})`);
  return `${provider}: disconnected`;
}

export async function runComposerSlashCommand(
  parsed: ParsedComposerSlash,
  ctx: {
    attachmentCount: number;
    abortTurn: () => void | Promise<void>;
    attachImagePath?: (path: string) => Promise<string | null>;
  }
): Promise<SlashRunnerResult> {
  switch (parsed.kind) {
    case "help":
      return { handled: true, message: formatSlashHelpText(), clearInput: true };
    case "integrations_status":
      return {
        handled: true,
        message: await fetchIntegrationsSummary(),
        clearInput: true,
      };
    case "abort":
      await ctx.abortTurn();
      return { handled: true, message: "Turn abort requested.", clearInput: true };
    case "receipt_workflow": {
      if (ctx.attachmentCount === 0) {
        return {
          handled: true,
          message: "Attach a receipt image first, then /receipt [note] or Process receipts.",
          clearInput: false,
        };
      }
      const text = parsed.note.trim() || "Process the attached receipt(s) into Xero as draft bill(s).";
      return {
        handled: true,
        send: { text, workflowPreset: "receipt_to_xero" },
        clearInput: true,
      };
    }
    case "attach": {
      const path = parsed.args[0]?.trim();
      if (!path) {
        return { handled: true, message: "Usage: /attach <image-path>", clearInput: false };
      }
      if (!ctx.attachImagePath) {
        return {
          handled: true,
          message: "Image attach from path is not available in this client.",
          clearInput: false,
        };
      }
      const err = await ctx.attachImagePath(path);
      if (err) return { handled: true, message: err, clearInput: false };
      return { handled: true, message: `Attached ${path}`, clearInput: true };
    }
    case "connect": {
      const provider = parsed.args[0]?.toLowerCase();
      if (!provider) {
        return {
          handled: true,
          message: "Usage: /connect <slack|linear|notion|xero|github|google|microsoft> [--read-only]",
          clearInput: false,
        };
      }
      if (provider === "azure") {
        return {
          handled: true,
          message: "Azure: use Settings → Integrations (not yet on /connect).",
          clearInput: false,
        };
      }
      try {
        const msg = await connectProvider(provider, parsed.readOnly);
        return { handled: true, message: msg, clearInput: true };
      } catch (err) {
        return {
          handled: true,
          message: err instanceof Error ? err.message : String(err),
          clearInput: false,
        };
      }
    }
    case "disconnect": {
      const provider = parsed.args[0]?.toLowerCase();
      if (!provider) {
        return {
          handled: true,
          message: "Usage: /disconnect <provider>",
          clearInput: false,
        };
      }
      if (provider === "azure") {
        return {
          handled: true,
          message: "Azure: use Settings → Integrations.",
          clearInput: false,
        };
      }
      try {
        const msg = await disconnectProvider(provider);
        return { handled: true, message: msg, clearInput: true };
      } catch (err) {
        return {
          handled: true,
          message: err instanceof Error ? err.message : String(err),
          clearInput: false,
        };
      }
    }
    case "remote": {
      if (!parsed.remote) {
        return { handled: true, message: "Invalid /remote usage.", clearInput: false };
      }
      const cmd = remoteSlashToCommand(parsed.remote, "");
      try {
        if (cmd.action === "enable") {
          const res = await webApiFetch("/api/remote/enable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              mode: cmd.mode,
              cloud: cmd.cloud,
            }),
          });
          const body = (await res.json()) as {
            error?: string;
            message?: string;
            joinCode?: string;
            lanUrl?: string | null;
            cloudUrl?: string | null;
            expiresAt?: number;
            mode?: string;
          };
          if (!res.ok) {
            return {
              handled: true,
              message: body.error ?? `Remote enable failed (${res.status})`,
              clearInput: false,
            };
          }
          return {
            handled: true,
            message:
              body.message ??
              formatRemoteEnableMessage({
                joinCode: body.joinCode ?? "",
                lanUrl: body.lanUrl,
                cloudUrl: body.cloudUrl,
                expiresAt: body.expiresAt ?? Date.now(),
                mode: body.mode ?? cmd.mode,
              }),
            clearInput: true,
          };
        }
        if (cmd.action === "disable") {
          const res = await webApiFetch("/api/remote/disable", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          });
          const body = (await res.json()) as { message?: string; error?: string };
          return {
            handled: true,
            message: body.message ?? body.error ?? "Remote disabled.",
            clearInput: true,
          };
        }
        if (cmd.action === "status") {
          const res = await webApiFetch("/api/remote/status");
          const body = (await res.json()) as Record<string, unknown> & { message?: string };
          return {
            handled: true,
            message: body.message ?? formatRemoteStatusMessage(body as never),
            clearInput: true,
          };
        }
        const res = await webApiFetch("/api/remote/revoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ joinCode: cmd.joinCode }),
        });
        const body = (await res.json()) as { message?: string; error?: string };
        return {
          handled: true,
          message: body.message ?? body.error ?? "Revoked.",
          clearInput: true,
        };
      } catch (err) {
        return {
          handled: true,
          message: err instanceof Error ? err.message : String(err),
          clearInput: false,
        };
      }
    }
    default:
      return { handled: false };
  }
}

export function tryParseComposerSlash(text: string): ParsedComposerSlash | null {
  return parseComposerSlashSubmit(text.trim());
}
