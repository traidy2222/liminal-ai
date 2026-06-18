import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatAnalyticsTable,
  formatChannelPayload,
  formatVideoPayload,
  normalizeVideoItem,
  resolveAnalyticsPreset,
  validateAnalyticsMetricsList,
} from "./youtube_format.js";

test("normalizeVideoItem separates views and likes", () => {
  const item = normalizeVideoItem({
    id: "abc123",
    snippet: { title: "Test video", publishedAt: "2026-01-01T00:00:00Z" },
    statistics: { viewCount: "1200", likeCount: "45", commentCount: "3" },
    status: { privacyStatus: "public" },
    contentDetails: { duration: "PT5M" },
  });
  assert.equal(item.statistics.views, 1200);
  assert.equal(item.statistics.likes, 45);
  assert.equal(item.statistics.comments, 3);
  assert.match(String((item.metricNotes as Record<string, string>).views), /NOT likes/i);
});

test("formatChannelPayload labels viewCount", () => {
  const out = formatChannelPayload({
    items: [
      {
        id: "UCtest",
        snippet: { title: "My Channel", customUrl: "@mychannel" },
        statistics: { subscriberCount: "100", viewCount: "50000", videoCount: "12" },
      },
    ],
  });
  const ch = (out.channels as Array<Record<string, unknown>>)[0];
  assert.equal((ch.statistics as Record<string, number>).viewCount, 50000);
  assert.equal(out.source, "youtube_data_api_v3");
});

test("formatAnalyticsTable maps rows to named columns", () => {
  const out = formatAnalyticsTable(
    {
      columnHeaders: [
        { name: "day", columnType: "DIMENSION", dataType: "STRING" },
        { name: "views", columnType: "METRIC", dataType: "INTEGER" },
        { name: "likes", columnType: "METRIC", dataType: "INTEGER" },
      ],
      rows: [
        ["2026-01-01", 100, 5],
        ["2026-01-02", 80, 3],
      ],
    },
    { startDate: "2026-01-01", endDate: "2026-01-02", metrics: "views,likes", dimensions: "day" }
  );
  const rows = out.rows as Array<Record<string, number>>;
  assert.equal(rows[0].views, 100);
  assert.equal(rows[0].likes, 5);
  assert.equal((out.totals as Record<string, number>).views, 180);
  assert.equal((out.totals as Record<string, number>).likes, 8);
  assert.match(String(out.interpretation), /views ≠ likes|NOT interchange/i);
});

test("validateAnalyticsMetricsList rejects bare impressions", () => {
  const err = validateAnalyticsMetricsList(["views", "impressions"]);
  assert.ok(err);
  assert.match(err!, /impressions/i);
});

test("resolveAnalyticsPreset top_videos sorts by views not likes", () => {
  const spec = resolveAnalyticsPreset("top_videos");
  assert.match(spec.metrics, /views/);
  assert.match(spec.metrics, /likes/);
  assert.equal(spec.sort, "-views");
  assert.equal(spec.dimensions, "video");
});

test("formatVideoPayload preserves pagination token", () => {
  const out = formatVideoPayload({
    items: [{ id: "v1", snippet: { title: "A" }, statistics: { viewCount: "1", likeCount: "0" } }],
    searchNextPageToken: "next",
  });
  assert.equal(out.searchNextPageToken, "next");
  assert.equal((out.videos as Array<Record<string, unknown>>).length, 1);
});
