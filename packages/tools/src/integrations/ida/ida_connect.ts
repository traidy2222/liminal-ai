/**
 * Curated IDA Pro MCP — local idalib-mcp sidecar or external plugin/SSE URL.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolRegistry } from "@liminal/core";
import { effectiveHarnessEnvRaw } from "@liminal/core";
import {
  deleteConnection,
  listConnectionsByParent,
  readConnection,
  type AuthScheme,
} from "../external_api/api_connections_store.js";
import { attachMcpConnection, unregisterMcpConnection } from "../external_api/mcp_attach.js";
import {
  ensureIdaSidecarRunning,
  idaSidecarEnabled,
  idaSidecarMcpUrl,
  stopIdaSidecar,
} from "./ida_sidecar.js";
import { enrichIdaConnectError, idaGuiMcpUrl, probeIdaMcpInitialize, withIdaMcpExtensions } from "./ida_probe.js";
import { resetIdaActiveDatabase } from "./ida_session.js";

export const IDA_PARENT_PROVIDER = "ida";
export const IDA_MCP_CONNECTION_NAME = "ida";

export function idaMcpEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_IDA_MCP") === "1";
}

/** Attach on boot only when explicitly enabled (IDA install is optional). */
export function idaConnectOnBoot(): boolean {
  return effectiveHarnessEnvRaw("AGENT_IDA_CONNECT_ON_BOOT") === "1";
}

export function idaMcpUrl(): string {
  return idaSidecarMcpUrl();
}

export function idaSetupHint(): string {
  return (
    "IDA Pro MCP setup:\n" +
    "1) pip install -U ida-pro-mcp (IDA Pro 8.3+, Python 3.11+, idalib for headless).\n" +
    "2) Set AGENT_IDA_MCP=1, then connect_provider({ provider: \"ida\" }).\n" +
    "3) Liminal ships ida_apply_patches_to_input + ida_get_input_metadata in-repo (no site-packages patch required).\n" +
    "4) Optional: npm run ida:patch-liminal adds native MCP copies; AGENT_IDA_MCP_PATCH_LIMINAL=1 on connect.\n" +
    "5) idb_list → patch → ida_apply_patches_to_input → shell verify."
  );
}

let liminalPatchAttempted = false;

/** Optional: inject native MCP tools into pip-installed ida-pro-mcp (off by default). */
export function ensureIdaLiminalMcpPatch(): void {
  if (!idaLiminalMcpPatchEnabled()) return;
  if (liminalPatchAttempted) return;
  liminalPatchAttempted = true;
  try {
    const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../");
    const patchScript = path.join(repoRoot, "scripts", "patch-ida-pro-mcp-liminal.mjs");
    spawnSync(process.execPath, [patchScript], { cwd: repoRoot, stdio: "ignore" });
  } catch {
    /* optional */
  }
}

function idaLiminalMcpPatchEnabled(): boolean {
  return effectiveHarnessEnvRaw("AGENT_IDA_MCP_PATCH_LIMINAL") === "1";
}

/** True when MCP is enabled and a server endpoint answers initialize. */
export async function idaMcpReachable(): Promise<{
  reachable: boolean;
  url?: string;
  viaGui?: boolean;
  detail?: string;
}> {
  if (!idaMcpEnabled()) {
    return { reachable: false, detail: "AGENT_IDA_MCP=0" };
  }
  const override = effectiveHarnessEnvRaw("AGENT_IDA_MCP_URL")?.trim();
  if (override) {
    const probe = await probeIdaMcpInitialize(override);
    return probe.ok
      ? { reachable: true, url: override }
      : { reachable: false, url: override, detail: `no response at ${override}` };
  }
  if (idaSidecarEnabled()) {
    const sidecar = await ensureIdaSidecarRunning();
    if (sidecar.ok) {
      return { reachable: true, url: sidecar.url };
    }
  }
  const guiUrl = idaGuiMcpUrl();
  const guiProbe = await probeIdaMcpInitialize(guiUrl);
  if (guiProbe.ok) {
    return { reachable: true, url: guiUrl, viaGui: true };
  }
  return {
    reachable: false,
    detail: "idalib sidecar not ready and IDA GUI MCP plugin not reachable on :13337",
  };
}

async function resolveIdaMcpUrl(
  mcpUrlOverride?: string
): Promise<{ url: string; sidecarManaged: boolean; viaGuiFallback?: boolean } | { error: string }> {
  const override = mcpUrlOverride?.trim() || effectiveHarnessEnvRaw("AGENT_IDA_MCP_URL")?.trim();
  if (override) {
    const url = withIdaMcpExtensions(override);
    const probe = await probeIdaMcpInitialize(url);
    if (!probe.ok) {
      return {
        error: `IDA MCP not reachable at ${url}. Start idalib-mcp or the IDA GUI plugin.`,
      };
    }
    return { url, sidecarManaged: false };
  }
  if (idaSidecarEnabled()) {
    const sidecar = await ensureIdaSidecarRunning();
    if (sidecar.ok) {
      return { url: sidecar.url, sidecarManaged: true };
    }
    const guiUrl = idaGuiMcpUrl();
    const guiProbe = await probeIdaMcpInitialize(guiUrl);
    if (guiProbe.ok) {
      return { url: guiUrl, sidecarManaged: false, viaGuiFallback: true };
    }
    return {
      error:
        (sidecar.error ?? "IDA MCP sidecar failed to start") +
        `. GUI plugin also unreachable at ${guiUrl}.`,
    };
  }
  const guiUrl = idaGuiMcpUrl();
  const guiProbe = await probeIdaMcpInitialize(guiUrl);
  if (guiProbe.ok) {
    return { url: guiUrl, sidecarManaged: false };
  }
  return {
    error:
      "No AGENT_IDA_MCP_URL set and AGENT_IDA_SIDECAR_ENABLE=0. " +
      "Start idalib-mcp or the IDA MCP plugin (Edit → Plugins → MCP), set the URL, or re-enable the sidecar.",
  };
}

async function attachIdaAtUrl(
  registry: ToolRegistry,
  resolved: { url: string; sidecarManaged: boolean; viaGuiFallback?: boolean },
  readOnly: boolean
): Promise<{ ok: true; output: string; toolCount: number }> {
  const auth: AuthScheme = { kind: "none" };
  const { record, registered } = await attachMcpConnection(registry, {
    name: IDA_MCP_CONNECTION_NAME,
    url: resolved.url,
    auth,
    readOnly,
    parentProvider: IDA_PARENT_PROVIDER,
    providerId: "ida",
    services: [readOnly ? "read_only" : "read_write"],
    sidecarManaged: resolved.sidecarManaged,
    autoActivate: true,
  });
  resetIdaActiveDatabase();
  const viaNote = resolved.viaGuiFallback
    ? " (auto-selected IDA GUI MCP plugin — headless idalib unavailable)\n"
    : "";
  return {
    ok: true,
    output:
      `Connected IDA Pro MCP at ${resolved.url}\n` +
      viaNote +
      `Registered ${registered.length} tools as mcp_${record.name}_* (decompile, disasm, xrefs, patch, apply_patches_to_input, …).\n` +
      `After mcp_ida_idb_list, the active database is remembered and auto-passed as database/session_id on later tools.\n` +
      `Lazy load: activate_tool_family({ family: "ida" }) — auto-activated on connect when lazy loading is on.`,
    toolCount: registered.length,
  };
}

export async function connectIdaMcp(
  registry: ToolRegistry,
  opts?: { readOnly?: boolean; mcpUrl?: string }
): Promise<{ ok: true; output: string; toolCount: number } | { ok: false; error: string }> {
  if (!idaMcpEnabled()) {
    return {
      ok: false,
      error: "IDA MCP disabled (set AGENT_IDA_MCP=1). " + idaSetupHint(),
    };
  }

  ensureIdaLiminalMcpPatch();
  const resolved = await resolveIdaMcpUrl(opts?.mcpUrl);
  if ("error" in resolved) {
    return { ok: false, error: `${resolved.error}\n\n${idaSetupHint()}` };
  }

  try {
    return await attachIdaAtUrl(registry, resolved, opts?.readOnly === true);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const hasExplicitUrl =
      Boolean(opts?.mcpUrl?.trim()) || Boolean(effectiveHarnessEnvRaw("AGENT_IDA_MCP_URL")?.trim());
    if (!hasExplicitUrl && !resolved.viaGuiFallback) {
      const guiUrl = idaGuiMcpUrl();
      if (guiUrl !== resolved.url && (await probeIdaMcpInitialize(guiUrl)).ok) {
        if (resolved.sidecarManaged) {
          await stopIdaSidecar(true);
        }
        try {
          return await attachIdaAtUrl(
            registry,
            { url: guiUrl, sidecarManaged: false, viaGuiFallback: true },
            opts?.readOnly === true
          );
        } catch (e2) {
          const raw2 = e2 instanceof Error ? e2.message : String(e2);
          return {
            ok: false,
            error: enrichIdaConnectError(`${raw}\n\nGUI fallback also failed: ${raw2}`) + `\n\n${idaSetupHint()}`,
          };
        }
      }
    }
    return {
      ok: false,
      error: enrichIdaConnectError(raw) + `\n\n${idaSetupHint()}`,
    };
  }
}

export async function disconnectIdaMcp(
  registry: ToolRegistry | ToolRegistry[]
): Promise<{ ok: true; output: string } | { ok: false; error: string }> {
  const registries = Array.isArray(registry) ? registry : [registry];
  const conns = await listConnectionsByParent(IDA_PARENT_PROVIDER);
  const legacy = await readConnection(IDA_MCP_CONNECTION_NAME);
  const toRemove = conns.length > 0 ? conns : legacy?.kind === "mcp" ? [legacy] : [];
  if (toRemove.length === 0) {
    return { ok: false, error: "no IDA MCP connection attached" };
  }
  let removed = 0;
  let stoppedSidecar = false;
  for (const c of toRemove) {
    for (const reg of registries) {
      removed += unregisterMcpConnection(reg, c);
    }
    if (c.sidecarManaged) {
      await stopIdaSidecar(true);
      stoppedSidecar = true;
    }
    await deleteConnection(c.name);
  }
  resetIdaActiveDatabase();
  return {
    ok: true,
    output:
      `Disconnected IDA MCP. Removed ${removed} tools from ${toRemove.length} connection(s)` +
      (stoppedSidecar ? " (sidecar stopped)" : "") +
      ".",
  };
}
