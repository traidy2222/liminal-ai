/**
 * Normalize YouTube Data API + Analytics API responses with unambiguous metric labels.
 * Prevents confusing lifetime viewCount (Data API) with likes or Analytics period views.
 */

export const METRIC_GLOSSARY: Readonly<Record<string, string>> = {
  views:
    "Analytics: views in the date range. NOT likes. Differs from Data API viewCount (lifetime public total).",
  likes: "Analytics: like actions in the date range. NOT views.",
  dislikes: "Analytics: dislike actions in the date range.",
  comments: "Comment activity in the date range (Analytics) or lifetime public count (Data API commentCount).",
  shares: "Times viewers shared the video in the date range.",
  estimatedMinutesWatched: "Total watch time in minutes for the period.",
  averageViewDuration: "Average watch duration per view in seconds.",
  subscribersGained: "New subscribers in the period.",
  subscribersLost: "Unsubscribes in the period.",
  viewCount: "Data API only — lifetime public views. NOT likes.",
  likeCount: "Data API only — lifetime public likes. NOT views.",
  commentCount: "Data API only — lifetime public comments.",
  videoThumbnailImpressions:
    "Reach metric — thumbnail impressions. Requires video dimension; use youtube_analytics_report top_videos or video_daily.",
  engagedViews: "Views past the initial seconds (engaged views).",
};

/** Bare "impressions" is not a valid Analytics metric — Studio uses videoThumbnailImpressions. */
const INVALID_BARE_METRICS = new Set(["impressions", "impression"]);

/** Common Analytics metrics (not exhaustive — unknown metrics pass through with a warning). */
export const ANALYTICS_KNOWN_METRICS = new Set([
  "views",
  "likes",
  "dislikes",
  "comments",
  "shares",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "subscribersGained",
  "subscribersLost",
  "videosAddedToPlaylists",
  "videosRemovedFromPlaylists",
  "engagedViews",
  "viewerPercentage",
  "annotationClickThroughRate",
  "annotationCloseRate",
  "cardImpressions",
  "cardClicks",
  "cardClickRate",
  "cardTeaserImpressions",
  "cardTeaserClicks",
  "cardTeaserClickRate",
  "estimatedRevenue",
  "estimatedAdRevenue",
  "estimatedRedPartnerRevenue",
  "grossRevenue",
  "cpm",
  "adImpressions",
  "monetizedPlaybacks",
  "playbackBasedCpm",
  "videoThumbnailImpressions",
  "videoThumbnailImpressionsClickRate",
]);

export type AnalyticsColumnHeader = {
  name?: string;
  columnType?: string;
  dataType?: string;
};

export type AnalyticsResultTable = {
  columnHeaders?: AnalyticsColumnHeader[];
  rows?: Array<Array<string | number>>;
};

export function parseCount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function formatChannelPayload(data: unknown): Record<string, unknown> {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = Array.isArray(root.items) ? root.items : [];
  const channels = items.map((item) => {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const snippet = (row.snippet ?? {}) as Record<string, unknown>;
    const stats = (row.statistics ?? {}) as Record<string, unknown>;
    const content = (row.contentDetails ?? {}) as Record<string, unknown>;
    return {
      channelId: String(row.id ?? ""),
      title: String(snippet.title ?? ""),
      customUrl: String(snippet.customUrl ?? ""),
      description: String(snippet.description ?? "").slice(0, 500),
      publishedAt: snippet.publishedAt ?? null,
      uploadsPlaylistId: content.relatedPlaylists
        ? String((content.relatedPlaylists as Record<string, unknown>).uploads ?? "")
        : "",
      statistics: {
        subscriberCount: parseCount(stats.subscriberCount),
        viewCount: parseCount(stats.viewCount),
        videoCount: parseCount(stats.videoCount),
        hiddenSubscriberCount: stats.hiddenSubscriberCount === true,
      },
      metricNotes: {
        viewCount: METRIC_GLOSSARY.viewCount,
        subscriberCount: "Lifetime public subscribers (may be hidden).",
      },
    };
  });
  return {
    source: "youtube_data_api_v3",
    channelCount: channels.length,
    channels,
  };
}

export function formatVideoPayload(data: unknown): Record<string, unknown> {
  const root = data && typeof data === "object" ? (data as Record<string, unknown>) : {};
  const items = Array.isArray(root.items) ? root.items : [];
  const videos = items.map((item) => normalizeVideoItem(item));
  const extra: Record<string, unknown> = {
    source: "youtube_data_api_v3",
    videoCount: videos.length,
    videos,
    metricNotes: {
      views: METRIC_GLOSSARY.viewCount,
      likes: METRIC_GLOSSARY.likeCount,
      comments: METRIC_GLOSSARY.commentCount,
    },
  };
  if (root.searchNextPageToken != null) {
    extra.searchNextPageToken = root.searchNextPageToken;
  }
  if (root.nextPageToken != null) {
    extra.nextPageToken = root.nextPageToken;
  }
  return extra;
}

export function normalizeVideoItem(item: unknown): Record<string, unknown> {
  const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
  const snippet = (row.snippet ?? {}) as Record<string, unknown>;
  const stats = (row.statistics ?? {}) as Record<string, unknown>;
  const status = (row.status ?? {}) as Record<string, unknown>;
  const content = (row.contentDetails ?? {}) as Record<string, unknown>;
  const views = parseCount(stats.viewCount);
  const likes = parseCount(stats.likeCount);
  return {
    videoId: String(row.id ?? ""),
    title: String(snippet.title ?? ""),
    description: String(snippet.description ?? "").slice(0, 300),
    publishedAt: snippet.publishedAt ?? null,
    channelId: snippet.channelId ?? null,
    tags: Array.isArray(snippet.tags) ? snippet.tags.map(String) : [],
    categoryId: snippet.categoryId ?? null,
    privacyStatus: status.privacyStatus ?? null,
    duration: content.duration ?? null,
    statistics: {
      views,
      likes,
      comments: parseCount(stats.commentCount),
    },
    metricNotes: {
      views: "Lifetime public views (viewCount). NOT likes.",
      likes: "Lifetime public likes (likeCount). NOT views.",
    },
  };
}

export function validateAnalyticsMetricsList(metrics: string[]): string | null {
  for (const m of metrics) {
    const key = m.trim();
    if (!key) continue;
    if (INVALID_BARE_METRICS.has(key.toLowerCase())) {
      return (
        `Invalid metric "${key}". YouTube Analytics has no bare "impressions" metric. ` +
        `Use videoThumbnailImpressions with dimension video (see youtube_analytics_report top_videos).`
      );
    }
  }
  return null;
}

export function unknownAnalyticsMetrics(metrics: string[]): string[] {
  return metrics.filter((m) => {
    const key = m.trim();
    return key && !ANALYTICS_KNOWN_METRICS.has(key);
  });
}

export function formatAnalyticsTable(
  data: unknown,
  context: { startDate: string; endDate: string; metrics: string; dimensions?: string }
): Record<string, unknown> {
  const table = data && typeof data === "object" ? (data as AnalyticsResultTable) : {};
  const headers = table.columnHeaders ?? [];
  const columns = headers.map((h) => ({
    name: String(h.name ?? ""),
    columnType: String(h.columnType ?? ""),
    dataType: String(h.dataType ?? ""),
    description: METRIC_GLOSSARY[String(h.name ?? "")] ?? undefined,
  }));
  const columnNames = columns.map((c) => c.name);
  const rows = (table.rows ?? []).map((row) => {
    const record: Record<string, string | number> = {};
    for (let i = 0; i < columnNames.length; i++) {
      const key = columnNames[i];
      if (!key) continue;
      const val = row[i];
      record[key] = typeof val === "number" ? val : String(val ?? "");
    }
    return record;
  });

  const metricCols = columns.filter((c) => c.columnType === "METRIC").map((c) => c.name);
  const totals: Record<string, number> = {};
  for (const m of metricCols) {
    let sum = 0;
    let any = false;
    for (const row of rows) {
      const v = row[m];
      const n = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(n)) {
        sum += n;
        any = true;
      }
    }
    if (any) totals[m] = sum;
  }

  const requested = context.metrics
    .split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  const metricGlossary: Record<string, string> = {};
  for (const m of requested) {
    if (METRIC_GLOSSARY[m]) metricGlossary[m] = METRIC_GLOSSARY[m];
  }

  const unknownMetrics = unknownAnalyticsMetrics(requested);

  return {
    source: "youtube_analytics_api_v2",
    period: { startDate: context.startDate, endDate: context.endDate },
    dimensions: context.dimensions?.trim() || null,
    columns,
    rowCount: rows.length,
    rows,
    totals: Object.keys(totals).length ? totals : undefined,
    metricGlossary,
    unknownMetrics: unknownMetrics.length ? unknownMetrics : undefined,
    interpretation:
      "views = watch count in period. likes = like actions in period. Do NOT interchange with Data API viewCount/likeCount.",
  };
}

export type AnalyticsReportPreset =
  | "channel_daily"
  | "top_videos"
  | "video_daily"
  | "traffic_sources"
  | "engagement_summary";

export function resolveAnalyticsPreset(preset: AnalyticsReportPreset): {
  metrics: string;
  dimensions?: string;
  sort?: string;
  filters?: string;
  maxResults: number;
  description: string;
} {
  switch (preset) {
    case "channel_daily":
      return {
        metrics: "views,estimatedMinutesWatched,subscribersGained,subscribersLost,likes,comments,shares",
        dimensions: "day",
        sort: "day",
        maxResults: 200,
        description: "Daily channel rollup — views, watch time, subs, likes, comments.",
      };
    case "top_videos":
      return {
        metrics: "views,estimatedMinutesWatched,likes,comments,shares,subscribersGained",
        dimensions: "video",
        sort: "-views",
        maxResults: 25,
        description: "Top videos by views in the period (Analytics period views, not lifetime Data API).",
      };
    case "video_daily":
      return {
        metrics: "views,estimatedMinutesWatched,likes,comments,shares,averageViewDuration",
        dimensions: "day",
        sort: "day",
        maxResults: 200,
        description: "Daily stats for one video (requires video_id filter).",
      };
    case "traffic_sources":
      return {
        metrics: "views,estimatedMinutesWatched",
        dimensions: "insightTrafficSourceType",
        sort: "-views",
        maxResults: 50,
        description: "Views and watch time by traffic source.",
      };
    case "engagement_summary":
      return {
        metrics: "views,likes,comments,shares,subscribersGained,estimatedMinutesWatched",
        maxResults: 1,
        description: "Channel totals for engagement — views vs likes are separate columns.",
      };
    default:
      return {
        metrics: "views,estimatedMinutesWatched",
        maxResults: 100,
        description: "Default channel metrics.",
      };
  }
}
