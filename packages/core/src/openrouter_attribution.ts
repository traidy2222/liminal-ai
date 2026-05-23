/**
 * OpenRouter app attribution headers (dashboard linking + rankings).
 * @see https://openrouter.ai/docs#request-headers
 */
export const DEFAULT_OPENROUTER_HTTP_REFERER = "https://github.com/traidy2222/liminal-ai";

/** Base app name sent as X-Title; sidecars append a hyphenated suffix. */
export const DEFAULT_OPENROUTER_X_TITLE = "Liminal";

export type OpenRouterAttributionHeaders = {
  "HTTP-Referer": string;
  "X-Title": string;
};

/** Build OpenRouter attribution headers; optional suffix → `Liminal-{suffix}`. */
export function buildOpenRouterAttributionHeaders(
  suffix?: string
): OpenRouterAttributionHeaders {
  const trimmed = suffix?.trim();
  return {
    "HTTP-Referer": DEFAULT_OPENROUTER_HTTP_REFERER,
    "X-Title": trimmed ? `${DEFAULT_OPENROUTER_X_TITLE}-${trimmed}` : DEFAULT_OPENROUTER_X_TITLE,
  };
}
