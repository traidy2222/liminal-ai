import { effectiveHarnessEnvRaw } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.round(value), max));
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) return { text: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "", bytes = 0, truncated = false;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      const slice = value.subarray(0, maxBytes - bytes);
      text += decoder.decode(slice, { stream: true });
      bytes += slice.byteLength;
      if (bytes >= maxBytes) { truncated = true; await reader.cancel(); break; }
    }
    text += decoder.decode();
    return { text, truncated };
  } finally { reader.releaseLock(); }
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n...[truncated ${value.length - maxChars} chars]`;
}

const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function urlUsesBareIp(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return IPV4_RE.test(host);
  } catch {
    return false;
  }
}

function ipProbeGuidance(url: string): string {
  let hostHint = "";
  try {
    const h = new URL(url).hostname;
    if (!IPV4_RE.test(h.replace(/^\[|\]$/g, ""))) {
      hostHint = ` Prefer web_fetch on https://${h}/ (hostname), not https://${h}:port/ on the raw IP.`;
    }
  } catch {
    /* ignore */
  }
  return (
    "HTTPS to a bare IP (especially non-443 ports) usually fails here (TLS/SNI/cipher)." +
    hostHint +
    " For probes use run_shell: curl.exe -k --connect-timeout 10 -H \"Host: <hostname>\" https://<ip>:<port>/ " +
    "or synthesize from Shodan/WHOIS the user already provided."
  );
}

export const httpRequestTool = defineTool({
  name: "http_request",
  description:
    "WHAT: Send an HTTP request to a URL and return status, headers, and body preview.\n" +
    "WHEN: Integrating with APIs where web_fetch/web_search are insufficient (custom method/headers/body).\n" +
    "NOT WHEN: Probing https://<IP>:<port> — use web_fetch on the hostname or run_shell curl with a Host header instead.\n" +
    "NOT WHEN: You only need page text retrieval or search; use web_fetch/web_search first.\n" +
    "ARGS: method, url, headers, body, timeout_ms, response_format.",
  requiresApproval: true,
  dangerLevel: "destructive",
  parameters: {
    type: "object",
    properties: {
      method: {
        type: "string",
        description: "HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS). Defaults to GET.",
      },
      url: {
        type: "string",
        description: "Absolute URL to request.",
      },
      headers: {
        type: "object",
        description: "Optional request headers.",
      },
      body: {
        type: "string",
        description: "Optional request body (raw string).",
      },
      timeout_ms: {
        type: "number",
        description: "Request timeout in milliseconds (default 15000, max 120000).",
      },
      response_format: {
        type: "string",
        enum: ["auto", "text", "json"],
        description: "How to parse response body. auto prefers json content-types, otherwise text.",
      },
      max_response_chars: {
        type: "number",
        description: "Maximum response body chars to return (default 12000, max 50000).",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const method = String(args["method"] ?? "GET").trim().toUpperCase();
    const url = String(args["url"] ?? "").trim();
    const body = typeof args["body"] === "string" ? args["body"] : undefined;
    const bareIp = urlUsesBareIp(url);
    const defaultTimeout = bareIp ? 12_000 : 15_000;
    const maxTimeout =
      parseInt(effectiveHarnessEnvRaw("AGENT_HTTP_REQUEST_MAX_TIMEOUT_MS") ?? "120000", 10) || 120_000;
    const timeoutMs = clampInt(Number(args["timeout_ms"] ?? defaultTimeout), 1000, maxTimeout);
    const responseFormat = String(args["response_format"] ?? "auto").trim().toLowerCase();
    const maxResponseChars = clampInt(Number(args["max_response_chars"] ?? 12000), 200, 50000);
    const allowedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
    if (!allowedMethods.has(method)) {
      return { ok: false, error: `Unsupported method "${method}". Allowed: ${[...allowedMethods].join(", ")}` };
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: "url must be an absolute http(s) URL." };
    }

    if (bareIp && !Object.entries((args["headers"] as Record<string, unknown> | undefined) ?? {})
      .some(([key, value]) => key.toLowerCase() === "host" && typeof value === "string" && value.trim())) {
      return {
        ok: true,
        output: JSON.stringify(
          {
            ok: false,
            skipped: true,
            reason: "bare_ip_without_host_header",
            url,
            guidance: ipProbeGuidance(url),
          },
          null,
          2
        ),
      };
    }

    const headersRaw = (args["headers"] as Record<string, unknown> | undefined) ?? {};
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(headersRaw)) {
      if (typeof v === "string") headers[k] = v;
      else if (v != null) headers[k] = String(v);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        redirect: "manual",
        method,
        headers,
        ...(body != null ? { body } : {}),
        signal: ac.signal,
      });
      const contentType = response.headers.get("content-type") ?? "";
      const shouldParseJson = responseFormat === "json" || (responseFormat === "auto" && /json/i.test(contentType));
      let responseBody = "";
      let bodyTruncated = false;
      if (method !== "HEAD") {
        const body = await readBoundedBody(response, maxResponseChars * 4);
        responseBody = body.text;
        bodyTruncated = body.truncated;
        if (shouldParseJson && !bodyTruncated) {
          try {
            const parsed = JSON.parse(responseBody) as unknown;
            responseBody = JSON.stringify(parsed, null, 2);
          } catch {
            // Preserve the original text if the declared JSON is malformed.
          }
        }
      }

      const outHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        outHeaders[k] = v;
      });

      const envelope = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        url: response.url,
        method,
        headers: outHeaders,
        body: truncate(responseBody, maxResponseChars) + (bodyTruncated ? "\n...[truncated at response byte limit]" : ""),
      };
      return { ok: true, output: JSON.stringify(envelope, null, 2) };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const envelope = {
        ok: false,
        error: msg,
        url,
        method,
        guidance: bareIp ? ipProbeGuidance(url) : undefined,
      };
      return { ok: true, output: JSON.stringify(envelope, null, 2) };
    } finally {
      clearTimeout(timer);
    }
  },
});
