/**
 * OneNote page REST helpers.
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  graphApiJson,
  graphJsonResult,
  graphErrorResult,
  microsoftRestEnabled,
} from "./graph_rest.js";

export function onenoteRestEnabled(): boolean {
  return microsoftRestEnabled();
}

export function createOnenoteRestTools(): ToolDefinition[] {
  const createPage = defineTool({
    name: "onenote_rest_create_page",
    description: "Create a OneNote page in a section with HTML body.",
    parameters: {
      type: "object",
      properties: {
        section_id: { type: "string", description: "OneNote section id." },
        title: { type: "string" },
        body_html: { type: "string", description: "HTML content for the page body." },
      },
      required: ["section_id", "body_html"],
      additionalProperties: false,
    },
    requiresApproval: true,
    handler: async (args): Promise<ToolResult> => {
      if (!onenoteRestEnabled()) return graphErrorResult("OneNote REST is off.");
      const sectionId = String(args["section_id"] ?? "").trim();
      const title = String(args["title"] ?? "Untitled").trim();
      const bodyHtml = String(args["body_html"] ?? "").trim();
      const html = `<!DOCTYPE html><html><head><title>${title}</title></head><body>${bodyHtml}</body></html>`;
      const result = await graphApiJson(
        `/me/onenote/sections/${encodeURIComponent(sectionId)}/pages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/xhtml+xml" },
          body: html,
        }
      );
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  const listNotebooks = defineTool({
    name: "onenote_rest_list_notebooks",
    description: "List OneNote notebooks.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 30_000,
    handler: async (): Promise<ToolResult> => {
      if (!onenoteRestEnabled()) return graphErrorResult("OneNote REST is off.");
      const result = await graphApiJson("/me/onenote/notebooks");
      if (!result.ok) return graphErrorResult(result.error);
      return graphJsonResult(result.data);
    },
  });

  return [createPage, listNotebooks];
}
