/**
 * YouTube channel grounding for world context + per-turn analytics injections.
 */
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import { fetchPrimaryYoutubeChannel } from "./youtube_channel.js";
import { getYoutubeAccessToken, listYoutubeOAuthAccounts } from "./youtube_oauth_broker.js";
import {
  missingYoutubeScopes,
  youtubeConnectOptionsFromMetadata,
} from "./youtube_oauth_scopes.js";

/** User turn about channel performance, SEO, uploads, or Studio metrics. */
export function isYoutubeAnalyticsTurn(text: string): boolean {
  const t = text.trim();
  if (t.length < 6) return false;
  return (
    /\byoutube\b|\byt studio\b|\bchannel analytics\b|\bsubscriber count\b|\bsubscribers?\b/i.test(t) &&
    /\bviews?\b|\bwatch time\b|\btraffic\b|\bseo\b|\bshorts\b|\buploads?\b|\bvideo\b|\bmonetiz/i.test(t)
  ) || /\bviews?\s+(declined|dropped|down|up|spike|viral)\b/i.test(t)
    || /\b(youtube|channel)\s+(performance|analytics|stats?)\b/i.test(t);
}

/** Primed-memory disclaimer trigger (broader than analytics turn). */
export function isYoutubeMetricsQuery(text: string): boolean {
  const t = text.trim();
  if (t.length < 4) return false;
  return /\byoutube\b/i.test(t) && /\bviews?\b|\bwatch time\b|\btraffic\b|\bsubscribers?\b/i.test(t);
}

export const YOUTUBE_ANALYTICS_TURN_INJECTION =
  "[YOUTUBE ANALYTICS] Ground every view/subscriber/traffic claim in tool output from this turn. " +
  "Period performance → youtube_analytics_report (channel_daily, top_videos, traffic_sources). " +
  "Lifetime totals → youtube_rest_get_channel or youtube_rest_get_video (viewCount). " +
  "views ≠ estimatedMinutesWatched ≠ likes. Do NOT cite memory/vault view counts without re-fetching. " +
  "Start with youtube_rest_get_channel to confirm the connected channel, then analytics for the date range the user asked about.";

function fmtCount(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "unknown";
  return n.toLocaleString("en-US");
}

/** Lines for [WORLD CONTEXT] when YouTube OAuth is connected (lifetime stats only). */
export async function gatherYoutubeChannelContextLines(): Promise<string[] | null> {
  if (effectiveHarnessEnvRaw("AGENT_YOUTUBE_REST") === "0") return null;

  const accounts = await listYoutubeOAuthAccounts();
  if (accounts.length === 0) return null;

  const primary = accounts[0]!;
  const token = await getYoutubeAccessToken(primary.accountId);
  if (!token) {
    return [
      `OAuth: ${accounts.length} YouTube account(s) on disk but token unreadable — reconnect in Settings → Integrations → YouTube.`,
    ];
  }

  const channel =
    (await fetchPrimaryYoutubeChannel(token, { includeStatistics: true })) ??
    (primary.channelId
      ? {
          channelId: primary.channelId,
          title: primary.channelTitle ?? primary.channelId,
          customUrl: primary.customUrl,
          subscriberCount: null,
          viewCount: null,
          videoCount: null,
        }
      : null);

  if (!channel) {
    return [
      "OAuth connected but channels.list?mine=true failed — verify YouTube Data API + account owns a channel.",
    ];
  }

  const opts = youtubeConnectOptionsFromMetadata(
    { mode: primary.connectMode, monetary: primary.monetaryRequested },
    primary.connectMode ?? "read_write"
  );
  const missing = missingYoutubeScopes(primary.scopes, opts);
  const missingAnalytics = missing.filter((s) => s.includes("yt-analytics"));
  const analyticsOk = missingAnalytics.length === 0;

  const lines = [
    `Channel: ${channel.title}${channel.customUrl ? ` (${channel.customUrl})` : ""}`,
    `Channel id: ${channel.channelId}`,
    primary.email ? `Google account: ${primary.email}` : null,
    `Lifetime totals (Data API — NOT daily/period views): subscribers ${fmtCount(channel.subscriberCount)}, views ${fmtCount(channel.viewCount)}, videos ${fmtCount(channel.videoCount)}`,
    analyticsOk
      ? "Analytics scopes: ok — use youtube_analytics_report for period views/watch time."
      : `Analytics scopes: missing (${missingAnalytics.join(", ") || "reconnect"}) — reconnect YouTube with analytics enabled.`,
    "For 'how did we do last week?' call youtube_analytics_report; never infer daily views from lifetime viewCount above.",
  ].filter((ln): ln is string => Boolean(ln));

  return lines;
}
