export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube";
export const YT_ANALYTICS_READONLY_SCOPE = "https://www.googleapis.com/auth/yt-analytics.readonly";
export const YT_ANALYTICS_MONETARY_READONLY_SCOPE =
  "https://www.googleapis.com/auth/yt-analytics-monetary.readonly";

export type YoutubeConnectMode = "read_write" | "read_only";

export type YoutubeConnectOptions = {
  mode: YoutubeConnectMode;
  /** Request revenue / ad-performance reports (YouTube Partner Program). */
  monetary?: boolean;
};

export function youtubeConnectOptionsFromMetadata(
  metadata?: Record<string, unknown> | null,
  modeFallback: YoutubeConnectMode = "read_write"
): YoutubeConnectOptions {
  const mode =
    metadata?.mode === "read_only" || metadata?.mode === "read_write"
      ? metadata.mode
      : modeFallback;
  return { mode, monetary: metadata?.monetary === true };
}

function scopeGranted(set: Set<string>, scope: string): boolean {
  if (set.has(YOUTUBE_MANAGE_SCOPE) && scope !== YT_ANALYTICS_READONLY_SCOPE && scope !== YT_ANALYTICS_MONETARY_READONLY_SCOPE) {
    if (scope === YOUTUBE_READONLY_SCOPE || scope === YOUTUBE_UPLOAD_SCOPE) return true;
  }
  if (scope === YOUTUBE_READONLY_SCOPE) {
    return set.has(YOUTUBE_READONLY_SCOPE) || set.has(YOUTUBE_UPLOAD_SCOPE) || set.has(YOUTUBE_MANAGE_SCOPE);
  }
  if (scope === YOUTUBE_UPLOAD_SCOPE) {
    return set.has(YOUTUBE_UPLOAD_SCOPE) || set.has(YOUTUBE_MANAGE_SCOPE);
  }
  if (scope === YT_ANALYTICS_READONLY_SCOPE) {
    return set.has(YT_ANALYTICS_READONLY_SCOPE) || set.has(YT_ANALYTICS_MONETARY_READONLY_SCOPE);
  }
  return set.has(scope);
}

export function scopesForYoutubeConnect(opts: YoutubeConnectOptions): string[] {
  const scopes: string[] = [YOUTUBE_READONLY_SCOPE, YT_ANALYTICS_READONLY_SCOPE];
  if (opts.mode === "read_write") scopes.push(YOUTUBE_UPLOAD_SCOPE);
  if (opts.monetary) scopes.push(YT_ANALYTICS_MONETARY_READONLY_SCOPE);
  return [...new Set(scopes)];
}

/** @deprecated Use scopesForYoutubeConnect */
export function scopesForYoutubeMode(mode: YoutubeConnectMode, monetary = false): string[] {
  return scopesForYoutubeConnect({ mode, monetary });
}

export function missingYoutubeScopes(
  granted: readonly string[],
  opts: YoutubeConnectOptions = { mode: "read_write", monetary: false }
): string[] {
  const set = new Set(granted);
  return scopesForYoutubeConnect(opts).filter((s) => !scopeGranted(set, s));
}
