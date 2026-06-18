export const YOUTUBE_READONLY_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
export const YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
export const YOUTUBE_MANAGE_SCOPE = "https://www.googleapis.com/auth/youtube";

export type YoutubeConnectMode = "read_write" | "read_only";

export function scopesForYoutubeMode(mode: YoutubeConnectMode): string[] {
  if (mode === "read_only") {
    return [YOUTUBE_READONLY_SCOPE];
  }
  return [YOUTUBE_READONLY_SCOPE, YOUTUBE_UPLOAD_SCOPE];
}

export function missingYoutubeScopes(granted: readonly string[]): string[] {
  const required = scopesForYoutubeMode("read_write");
  const set = new Set(granted);
  if (set.has(YOUTUBE_MANAGE_SCOPE)) return [];
  const missing: string[] = [];
  if (!set.has(YOUTUBE_READONLY_SCOPE) && !set.has(YOUTUBE_UPLOAD_SCOPE)) {
    missing.push(YOUTUBE_READONLY_SCOPE);
  }
  if (!set.has(YOUTUBE_UPLOAD_SCOPE) && required.includes(YOUTUBE_UPLOAD_SCOPE)) {
    if (!set.has(YOUTUBE_MANAGE_SCOPE)) missing.push(YOUTUBE_UPLOAD_SCOPE);
  }
  return [...new Set(missing)];
}
