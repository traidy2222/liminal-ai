import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";

const DIRECT_LOOKUP_TOOLS = ["web_search", "web_fetch", "http_request", "markets_quote", "weather_lookup"] as const;

/** Tool availability, not authorization: ordinary research uses the browser.
 * Only the real user's explicit utility request can expose a direct lookup tool.
 * Child agents inherit their parent's restrictions rather than unlocking tools
 * through model-written delegation instructions. */
export function browserFirstSuppressedTools(userMessage: string, standaloneEnabled = effectiveHarnessEnvRaw("AGENT_WEB_SEARCH_FETCH") === "1"): string[] {
  if (standaloneEnabled) return [];
  const allowed = new Set<string>();
  const explicit = (pattern: RegExp) => [...userMessage.matchAll(pattern)].some(match =>
    !/\b(?:don't|do not|never|avoid)\s*$/i.test(userMessage.slice(Math.max(0, match.index! - 32), match.index)));
  for (const name of ["http_request", "markets_quote", "weather_lookup"]) {
    if (explicit(new RegExp(`\\b(?:use|call|run|invoke|execute)\\s+(?:the\\s+)?${name}\\b`, "gi"))) allowed.add(name);
  }
  if (explicit(/\b(?:make|send|issue|perform|test|use)\s+(?:(?:a|an|the|raw)\s+)?https?\s+requests?\b/gi) ||
      explicit(/\b(?:use|call|query|test|invoke)\s+(?:(?:the|this|an?|rest|json|graphql)\s+){0,3}api\b/gi)) allowed.add("http_request");
  if (explicit(/\buse\s+(?:the\s+)?markets?\s+quotes?(?:\s+tool)?\b/gi)) allowed.add("markets_quote");
  if (explicit(/\buse\s+(?:the\s+)?weather\s+lookup\s+tool\b/gi)) allowed.add("weather_lookup");
  return DIRECT_LOOKUP_TOOLS.filter(name => !allowed.has(name));
}
