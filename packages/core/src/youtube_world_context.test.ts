import test from "node:test";
import assert from "node:assert/strict";

import {
  isYoutubeAnalyticsTurn,
  isYoutubeMetricsQuery,
} from "./youtube_world_context.js";
import { inferIntentToolFamilies } from "./intent_tool_families.js";

test("isYoutubeAnalyticsTurn detects channel performance questions", () => {
  assert.equal(isYoutubeAnalyticsTurn("my youtube views declined after seo changes"), true);
  assert.equal(isYoutubeAnalyticsTurn("check channel analytics for last week"), true);
  assert.equal(isYoutubeAnalyticsTurn("hello there"), false);
});

test("isYoutubeMetricsQuery is broader for memory disclaimer", () => {
  assert.equal(isYoutubeMetricsQuery("youtube views"), true);
  assert.equal(isYoutubeMetricsQuery("fix my code"), false);
});

test("inferIntentToolFamilies pre-seeds youtube on channel analytics turns", () => {
  const families = inferIntentToolFamilies("research", "youtube views dropped this week", {
    registryHas: (f) => f === "youtube" || f === "web",
  });
  assert.ok(families.includes("youtube"));
  assert.ok(families.includes("web"));
});
