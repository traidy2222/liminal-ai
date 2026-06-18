/**
 * YouTube Data API v3 — channel + video REST tools (separate from Google Workspace).
 */
import type { PropertySchema, ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import { jsonToolResult, qs, youtubeRestEnabled, youtubeRestJson } from "./youtube_rest_http.js";
import { createYoutubeAnalyticsRestTools } from "./youtube_analytics_rest.js";

export { youtubeRestEnabled };

function objectSchema(description: string): PropertySchema {
  return { type: "object", description, additionalProperties: true } as PropertySchema;
}

export function createYoutubeRestTools(): ToolDefinition[] {
  const youtubeRestGetChannel = defineTool({
    name: "youtube_rest_get_channel",
    description:
      "WHAT: Get the connected YouTube channel (title, id, custom URL, stats).\n" +
      "WHEN: Verify which channel is linked or read channel metadata.",
    parameters: {
      type: "object",
      properties: {
        channel_id: {
          type: "string",
          description: "Optional channel id (UC…). Defaults to the authenticated user's channel.",
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 120_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["channel_id"] ?? "").trim();
      const path = id
        ? `/channels${qs({ part: "snippet,statistics,contentDetails", id })}`
        : `/channels${qs({ part: "snippet,statistics,contentDetails", mine: true })}`;
      const res = await youtubeRestJson<unknown>(path);
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const youtubeRestListVideos = defineTool({
    name: "youtube_rest_list_videos",
    description:
      "WHAT: List videos on the connected channel (search → videos details).\n" +
      "WHEN: Inventory uploads, pick a video id for updates, or audit channel content.",
    parameters: {
      type: "object",
      properties: {
        channel_id: { type: "string", description: "Channel id (UC…). Omit for connected channel." },
        max_results: { type: "number", description: "Max videos (default 25, max 50)." },
        page_token: { type: "string" },
        order: {
          type: "string",
          enum: ["date", "rating", "relevance", "title", "videoCount", "viewCount"],
        },
      },
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const channelId = String(args["channel_id"] ?? "").trim();
      let resolvedChannelId = channelId;
      if (!resolvedChannelId) {
        const ch = await youtubeRestJson<{ items?: Array<{ id?: string }> }>(
          `/channels${qs({ part: "id", mine: true })}`
        );
        if (!ch.ok) return { ok: false, error: ch.error };
        resolvedChannelId = ch.data.items?.[0]?.id ?? "";
        if (!resolvedChannelId) return { ok: false, error: "No YouTube channel on this account." };
      }
      const max = Math.min(50, Math.max(1, Number(args["max_results"]) || 25));
      const search = await youtubeRestJson<{ items?: Array<{ id?: { videoId?: string } }>; nextPageToken?: string }>(
        `/search${qs({
          part: "id",
          channelId: resolvedChannelId,
          type: "video",
          order: String(args["order"] ?? "date") || "date",
          maxResults: max,
          pageToken: String(args["page_token"] ?? "") || undefined,
        })}`
      );
      if (!search.ok) return { ok: false, error: search.error };
      const ids = (search.data.items ?? [])
        .map((i) => i.id?.videoId)
        .filter((v): v is string => Boolean(v));
      if (ids.length === 0) {
        return jsonToolResult({ items: [], nextPageToken: search.data.nextPageToken });
      }
      const videos = await youtubeRestJson<unknown>(
        `/videos${qs({
          part: "snippet,contentDetails,statistics,status",
          id: ids.join(","),
        })}`
      );
      if (!videos.ok) return { ok: false, error: videos.error };
      const payload =
        videos.data && typeof videos.data === "object"
          ? { ...(videos.data as Record<string, unknown>), searchNextPageToken: search.data.nextPageToken }
          : { searchNextPageToken: search.data.nextPageToken };
      return jsonToolResult(payload);
    },
  });

  const youtubeRestUpdateVideo = defineTool({
    name: "youtube_rest_update_video",
    description:
      "WHAT: Update a video's snippet (title, description, tags, category) or privacy status.\n" +
      "WHEN: User asks to edit metadata on an existing upload.",
    parameters: {
      type: "object",
      properties: {
        video_id: { type: "string", description: "YouTube video id." },
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        category_id: { type: "string" },
        privacy_status: { type: "string", enum: ["public", "unlisted", "private"] },
      },
      required: ["video_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      const videoId = String(args["video_id"] ?? "").trim();
      if (!videoId) return { ok: false, error: "video_id required" };
      const get = await youtubeRestJson<{ items?: Array<{ id?: string; snippet?: Record<string, unknown>; status?: Record<string, unknown> }> }>(
        `/videos${qs({ part: "snippet,status", id: videoId })}`
      );
      if (!get.ok) return { ok: false, error: get.error };
      const item = get.data.items?.[0];
      if (!item) return { ok: false, error: `Video not found: ${videoId}` };
      const snippet = { ...(item.snippet ?? {}) } as Record<string, unknown>;
      const status = { ...(item.status ?? {}) } as Record<string, unknown>;
      if (args["title"] != null) snippet.title = String(args["title"]);
      if (args["description"] != null) snippet.description = String(args["description"]);
      if (Array.isArray(args["tags"])) snippet.tags = args["tags"].map(String);
      if (args["category_id"] != null) snippet.categoryId = String(args["category_id"]);
      if (args["privacy_status"] != null) status.privacyStatus = String(args["privacy_status"]);
      const res = await youtubeRestJson<unknown>(`/videos?part=snippet,status`, {
        init: {
          method: "PUT",
          body: JSON.stringify({ id: videoId, snippet, status }),
        },
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonToolResult(res.data);
    },
  });

  const youtubeRestUploadVideo = defineTool({
    name: "youtube_rest_upload_video",
    description:
      "WHAT: Start a resumable YouTube upload from a local video file path.\n" +
      "WHEN: User asks to publish a video file to their connected channel.\n" +
      "NOTE: Large files use resumable upload; returns upload URL + instructions.",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Absolute path to video file (mp4, mov, etc.)." },
        title: { type: "string" },
        description: { type: "string" },
        tags: { type: "array", items: { type: "string" } },
        privacy_status: { type: "string", enum: ["public", "unlisted", "private"] },
        category_id: { type: "string", description: "Default 22 (People & Blogs)." },
      },
      required: ["file_path", "title"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (): Promise<ToolResult> => {
      return {
        ok: false,
        error:
          "youtube_rest_upload_video: use run_shell with curl resumable upload or call youtube_rest_update_video after manual upload. " +
          "Full binary upload from harness is not implemented in v1 — metadata tools are available.",
      };
    },
  });

  return [
    youtubeRestGetChannel,
    youtubeRestListVideos,
    youtubeRestUpdateVideo,
    youtubeRestUploadVideo,
    ...createYoutubeAnalyticsRestTools(),
  ];
}
