/** Browser-safe provider URL classification. */
import { DEFAULT_AGENT_API_BASE_URL } from "./harness_default_constants.js";

export function isOpenRouterApiBaseUrl(baseURL: string | undefined | null): boolean {
  const raw = (baseURL ?? DEFAULT_AGENT_API_BASE_URL).trim();
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === "openrouter.ai" || host.endsWith(".openrouter.ai");
  } catch {
    return /openrouter\.ai/i.test(raw);
  }
}
