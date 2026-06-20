/**
 * Reachability probes for idalib-mcp (headless sidecar) and IDA GUI MCP plugin.
 */
import { effectiveHarnessEnvRaw } from "@liminal/core";

export const IDA_GUI_MCP_DEFAULT = "http://127.0.0.1:13337/mcp";

export function idaGuiMcpUrl(): string {
  return withIdaMcpExtensions(
    effectiveHarnessEnvRaw("AGENT_IDA_GUI_MCP_URL")?.trim() || IDA_GUI_MCP_DEFAULT
  );
}

/** Append ?ext=dbg when AGENT_IDA_MCP_DBG_EXT=1 (debugger MCP tools). */
export function withIdaMcpExtensions(url: string): string {
  const dbg = effectiveHarnessEnvRaw("AGENT_IDA_MCP_DBG_EXT") === "1";
  if (!dbg) return url;
  try {
    const parsed = new URL(url);
    const ext = parsed.searchParams.get("ext");
    if (ext?.split(",").includes("dbg")) return url;
    parsed.searchParams.set("ext", ext ? `${ext},dbg` : "dbg");
    return parsed.toString();
  } catch {
    return url.includes("?") ? `${url}&ext=dbg` : `${url}?ext=dbg`;
  }
}

export async function probeIdaMcpInitialize(
  url: string,
  timeoutMs = 6000
): Promise<{ ok: boolean; sessionId?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "liminal-ida-probe", version: "0.1.0" },
        },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status !== 200 && res.status !== 406) return { ok: false };
    const sessionId = res.headers.get("mcp-session-id")?.trim() || undefined;
    await res.arrayBuffer().catch(() => undefined);
    return { ok: true, sessionId };
  } catch {
    return { ok: false };
  }
}

export function enrichIdaConnectError(message: string): string {
  if (
    /SP1|get_name|get_prototype|get_udm|idalib worker exited|missing required Python API/i.test(
      message
    )
  ) {
    return (
      `${message}\n\n` +
      "Headless idalib-mcp needs **IDA Pro 9.0 SP1+**. Options:\n" +
      "1) Upgrade IDA to 9.0 SP1 or later, or\n" +
      "2) Open IDA Pro → Edit → Plugins → MCP (Ctrl+Alt+M), then set " +
      "`AGENT_IDA_MCP_URL=http://127.0.0.1:13337/mcp` and `AGENT_IDA_SIDECAR_ENABLE=0`, or connect again (Liminal auto-falls back to the GUI plugin when reachable)."
    );
  }
  if (/fetch failed|other side closed|ECONNREFUSED|not ready/i.test(message)) {
    return (
      `${message}\n\n` +
      "Ensure idalib-mcp is installed (`pip install ida-pro-mcp`) and idalib is activated, " +
      "or start the IDA MCP plugin in the GUI and set `AGENT_IDA_MCP_URL`."
    );
  }
  return message;
}
