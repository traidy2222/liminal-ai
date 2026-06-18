/**
 * YouTube Analytics metric helpers — see reports/query metric definitions.
 * https://developers.google.com/youtube/analytics/reference/reports/query
 */
import {
  YT_ANALYTICS_MONETARY_READONLY_SCOPE,
  missingYoutubeScopes,
  listOAuthAccounts,
  youtubeConnectOptionsFromMetadata,
  type YoutubeConnectOptions,
} from "@liminal/core";

/** Metrics that require yt-analytics-monetary.readonly (revenue / ad performance). */
const MONETARY_METRIC_RE =
  /^(estimatedRevenue|estimatedAdRevenue|estimatedRedPartnerRevenue|grossRevenue|cpm|adImpressions|monetizedPlaybacks|playbackBasedCpm|annotationClickThroughRate|annotationCloseRate|cardImpressions|cardClicks|cardClickRate|cardTeaserImpressions|cardTeaserClicks|cardTeaserClickRate)$/i;

export function splitAnalyticsMetrics(raw: string): string[] {
  return raw
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
}

export function analyticsMetricsNeedMonetaryScope(metrics: string): boolean {
  return splitAnalyticsMetrics(metrics).some((m) => MONETARY_METRIC_RE.test(m));
}

export async function youtubeAnalyticsScopeError(metrics: string): Promise<string | null> {
  if (!analyticsMetricsNeedMonetaryScope(metrics)) return null;
  const accounts = await listOAuthAccounts("youtube");
  const account = accounts[0];
  if (!account) return null;
  const opts: YoutubeConnectOptions = youtubeConnectOptionsFromMetadata(account.metadata, "read_write");
  const missing = missingYoutubeScopes(account.scopes, opts);
  if (!missing.includes(YT_ANALYTICS_MONETARY_READONLY_SCOPE)) return null;
  return (
    `Metrics include revenue/ad fields (${splitAnalyticsMetrics(metrics).filter((m) => MONETARY_METRIC_RE.test(m)).join(", ")}) ` +
    `but OAuth is missing ${YT_ANALYTICS_MONETARY_READONLY_SCOPE}. ` +
    "Reconnect YouTube in Settings → Integrations (enable revenue analytics) or " +
    'connect_provider({ provider: "youtube", start_oauth: true, force_reconnect: true }).'
  );
}
