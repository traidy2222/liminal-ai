/**
 * OpenRouter session tracking — groups generations in the dashboard for
 * multi-step agents, debug chains, and full conversations.
 * @see https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request
 */
import { DEFAULT_AGENT_API_BASE_URL } from "./harness_default_constants.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { resolveCurrentChatId } from "./chat_context.js";
import { isManagedInferenceBaseUrl } from "./inference_session.js";

const OPENROUTER_SESSION_ID_MAX_LEN = 256;

/** True when the configured API base is OpenRouter (or compatible proxy). */
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

/** OpenRouter-compatible routing/session extras (direct OR Vireon managed proxy). */
export function supportsOpenRouterRequestExtras(baseURL: string | undefined | null): boolean {
  const raw = (baseURL ?? "").trim();
  if (!raw) return false;
  return isOpenRouterApiBaseUrl(raw) || isManagedInferenceBaseUrl(raw);
}

/** Product default: on for OpenRouter bases unless AGENT_OPENROUTER_SESSIONS=0. */
export function openRouterSessionsEnabled(): boolean {
  const raw = effectiveHarnessEnvRaw("AGENT_OPENROUTER_SESSIONS")?.trim();
  if (raw === "0" || raw === "false") return false;
  return true;
}

/**
 * Clamp/sanitize session id for OpenRouter (≤256 chars).
 * Keeps letters, digits, and common separators used in UUIDs / paths.
 */
export function normalizeOpenRouterSessionId(sessionId: string): string {
  const trimmed = sessionId.trim();
  if (!trimmed) return "";
  const safe = trimmed.replace(/[^\w@:./+-]/g, "_");
  return safe.length <= OPENROUTER_SESSION_ID_MAX_LEN
    ? safe
    : safe.slice(0, OPENROUTER_SESSION_ID_MAX_LEN);
}

/**
 * Resolve the session id to send on OpenRouter chat requests.
 * Precedence: explicit arg → AGENT_OPENROUTER_SESSION_ID env → active chat/harness id.
 */
export function resolveOpenRouterSessionId(explicit?: string | null): string | null {
  const fromExplicit = explicit?.trim();
  if (fromExplicit) {
    const n = normalizeOpenRouterSessionId(fromExplicit);
    return n || null;
  }
  const fromEnv = effectiveHarnessEnvRaw("AGENT_OPENROUTER_SESSION_ID")?.trim();
  if (fromEnv) {
    const n = normalizeOpenRouterSessionId(fromEnv);
    return n || null;
  }
  const chatId = resolveCurrentChatId();
  if (chatId) {
    const n = normalizeOpenRouterSessionId(chatId);
    return n || null;
  }
  return null;
}

export type OpenRouterSessionRequestExtras = {
  /** OpenRouter observability grouping (Generations → Sessions). */
  session_id?: string;
  /** Legacy OpenAI `user` field — kept aligned with session_id for cache affinity. */
  user?: string;
};

/**
 * Extra fields to spread onto chat completion params when targeting OpenRouter.
 * No-op for non-OpenRouter bases or when AGENT_OPENROUTER_SESSIONS=0.
 */
export function buildOpenRouterSessionExtras(
  baseURL: string | undefined | null,
  sessionId?: string | null
): OpenRouterSessionRequestExtras {
  if (!supportsOpenRouterRequestExtras(baseURL) || !openRouterSessionsEnabled()) {
    return {};
  }
  const id = resolveOpenRouterSessionId(sessionId);
  if (!id) return {};
  return { session_id: id, user: id };
}
