/**
 * Microsoft Teams channel message REST helper.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "./helpers.js";
import {
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function teamsRestEnabled(): boolean {
  return microsoftRestEnabled();
}

export function createTeamsRestTools(): ToolDefinition[] {
  const postChannelMessage = defineTool({
    name: "teams_rest_post_channel_message",
    description: "Post a message to a Teams channel.",
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        channel_id: { type: "string" },
        content_html: { type: "string", description: "HTML message body." },
        content_text: { type: "string", description: "Plain text fallback." },
      },
      required: ["team_id", "channel_id"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!teamsRestEnabled()) return graphErrorResult("Teams REST is off.");
      const teamId = String(args["team_id"] ?? "").trim();
      const channelId = String(args["channel_id"] ?? "").trim();
      const html = String(args["content_html"] ?? "").trim();
      const text = String(args["content_text"] ?? "").trim();
      const body = {
        body: {
          contentType: html ? "html" : "text",
          content: html || text || "",
        },
      };
      const result = await graphApiJson(
        `/teams/${encodeURIComponent(teamId)}/channels/${encodeURIComponent(channelId)}/messages`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const listTeams = defineTool({
    name: "teams_rest_list_joined_teams",
    description: "List Teams the signed-in user has joined.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!teamsRestEnabled()) return graphErrorResult("Teams REST is off.");
      const result = await graphApiJson("/me/joinedTeams");
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [postChannelMessage, listTeams];
}
