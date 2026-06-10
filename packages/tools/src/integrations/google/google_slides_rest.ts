/**
 * Google Slides REST — classic slides.googleapis.com alongside mcp_google_ext_* (workspace-mcp).
 */
import type { ToolDefinition, ToolResult } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";
import {
  SLIDES_BASE,
  arraySchema,
  googleOfficeApiJson,
  objectSchema,
  qs,
} from "./google_office_rest_shared.js";

function jsonResult(data: unknown): ToolResult {
  return { ok: true, output: JSON.stringify(data, null, 2) };
}

export function createGoogleSlidesRestTools(): ToolDefinition[] {
  const slidesRestGetPresentation = defineTool({
    name: "slides_rest_get_presentation",
    description:
      "WHAT: Fetch a Google Slides deck by id (presentations.get) — slides, page elements, layouts.\n" +
      "WHEN: Need full Presentation JSON before batchUpdate or MCP read is insufficient.",
    parameters: {
      type: "object",
      properties: {
        presentation_id: { type: "string", description: "Slides file id (Drive id from URL)." },
        fields: { type: "string", description: "Partial response mask." },
      },
      required: ["presentation_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["presentation_id"] ?? "").trim();
      if (!id) return { ok: false, error: "presentation_id is required" };
      const q = qs({ fields: String(args["fields"] ?? "").trim() || undefined });
      const res = await googleOfficeApiJson<unknown>(
        SLIDES_BASE,
        "Slides API",
        `/presentations/${encodeURIComponent(id)}${q}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const slidesRestCreatePresentation = defineTool({
    name: "slides_rest_create_presentation",
    description:
      "WHAT: Create a blank presentation (presentations.create).\n" +
      "WHEN: New deck before slides_rest_batch_update (createSlide, insertText, …).",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Presentation title." },
      },
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const title = String(args["title"] ?? "").trim();
      const body = title ? { title } : {};
      const res = await googleOfficeApiJson<unknown>(SLIDES_BASE, "Slides API", "/presentations", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const slidesRestBatchUpdate = defineTool({
    name: "slides_rest_batch_update",
    description:
      "WHAT: Apply Slides batchUpdate requests (createSlide, insertText, replaceAllText, images, layouts, …).\n" +
      "WHEN: Build or edit decks with precise API control.\n" +
      "HOW: Pass `requests` per https://developers.google.com/slides/api/reference/rest/v1/presentations/request",
    parameters: {
      type: "object",
      properties: {
        presentation_id: { type: "string" },
        requests: arraySchema("Slides API Request objects."),
        write_control: objectSchema("Optional WriteControl."),
      },
      required: ["presentation_id", "requests"],
      additionalProperties: false,
    },
    requiresApproval: true,
    dangerLevel: "destructive",
    handler: async (args): Promise<ToolResult> => {
      const id = String(args["presentation_id"] ?? "").trim();
      if (!id) return { ok: false, error: "presentation_id is required" };
      if (!Array.isArray(args["requests"]) || args["requests"].length === 0) {
        return { ok: false, error: "requests array is required" };
      }
      const body: Record<string, unknown> = { requests: args["requests"] };
      if (args["write_control"] && typeof args["write_control"] === "object") {
        body.writeControl = args["write_control"];
      }
      const res = await googleOfficeApiJson<unknown>(
        SLIDES_BASE,
        "Slides API",
        `/presentations/${encodeURIComponent(id)}:batchUpdate`,
        { method: "POST", body: JSON.stringify(body) }
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const slidesRestGetPage = defineTool({
    name: "slides_rest_get_page",
    description:
      "WHAT: Get a single slide/page by object id (presentations.pages.get).\n" +
      "WHEN: Inspect one slide without loading the full deck.",
    parameters: {
      type: "object",
      properties: {
        presentation_id: { type: "string" },
        page_object_id: { type: "string", description: "Page object id from presentation.slides[].objectId." },
      },
      required: ["presentation_id", "page_object_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 15_000,
    handler: async (args): Promise<ToolResult> => {
      const presId = String(args["presentation_id"] ?? "").trim();
      const pageId = String(args["page_object_id"] ?? "").trim();
      if (!presId || !pageId) return { ok: false, error: "presentation_id and page_object_id are required" };
      const res = await googleOfficeApiJson<unknown>(
        SLIDES_BASE,
        "Slides API",
        `/presentations/${encodeURIComponent(presId)}/pages/${encodeURIComponent(pageId)}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  const slidesRestGetThumbnail = defineTool({
    name: "slides_rest_get_thumbnail",
    description:
      "WHAT: Render a slide thumbnail (presentations.pages.getThumbnail).\n" +
      "WHEN: Preview a slide image — returns contentUrl in JSON (short-lived Google CDN URL).",
    parameters: {
      type: "object",
      properties: {
        presentation_id: { type: "string" },
        page_object_id: { type: "string" },
        mime_type: { type: "string", enum: ["PNG"], description: "Only PNG supported." },
        thumbnail_size: {
          type: "string",
          enum: ["THUMBNAIL_SIZE_UNSPECIFIED", "LARGE", "MEDIUM", "SMALL"],
        },
      },
      required: ["presentation_id", "page_object_id"],
      additionalProperties: false,
    },
    requiresApproval: false,
    cacheable: true,
    cacheTtlMs: 60_000,
    handler: async (args): Promise<ToolResult> => {
      const presId = String(args["presentation_id"] ?? "").trim();
      const pageId = String(args["page_object_id"] ?? "").trim();
      if (!presId || !pageId) return { ok: false, error: "presentation_id and page_object_id are required" };
      const mime = String(args["mime_type"] ?? "").trim();
      const size = String(args["thumbnail_size"] ?? "").trim();
      const parts: string[] = [];
      if (mime === "PNG") parts.push(`mimeType=${encodeURIComponent("PNG")}`);
      if (size) parts.push(`thumbnailProperties.thumbnailSize=${encodeURIComponent(size)}`);
      const query = parts.length ? `?${parts.join("&")}` : "";
      const res = await googleOfficeApiJson<unknown>(
        SLIDES_BASE,
        "Slides API",
        `/presentations/${encodeURIComponent(presId)}/pages/${encodeURIComponent(pageId)}/thumbnail${query}`
      );
      if (!res.ok) return { ok: false, error: res.error };
      return jsonResult(res.data);
    },
  });

  return [
    slidesRestGetPresentation,
    slidesRestCreatePresentation,
    slidesRestBatchUpdate,
    slidesRestGetPage,
    slidesRestGetThumbnail,
  ];
}
