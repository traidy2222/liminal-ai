/**
 * Normalize remote MCP JSON schemas for harness validation.
 * Google MCP servers declare `integer` fields; JSON only has `number`.
 */
import type { PropertySchema } from "./types.js";

/** Canonical MCP field → common model aliases (also added to schema at registration). */
export const MCP_FIELD_ALIASES: Record<string, string[]> = {
  pageSize: ["page_size", "limit", "maxResults", "max_results"],
  pageToken: ["page_token", "nextPageToken", "next_page_token"],
  query: ["q", "search", "searchQuery", "search_query", "term", "text"],
  calendarId: ["calendar_id"],
  spaceName: ["space_name", "space"],
  userId: ["user_id"],
  messageId: ["message_id"],
  threadId: ["thread_id"],
  fileId: ["file_id"],
  eventId: ["event_id"],
  resourceName: ["resource_name"],
  parentName: ["parent_name"],
  name: ["displayName", "display_name", "title"],
};

export function normalizeMcpPropertyType(schema: PropertySchema): PropertySchema {
  const out: PropertySchema = { ...schema };
  if (out.type === "integer") {
    out.type = "number";
  }
  if (out.items) {
    out.items = normalizeMcpPropertyType(out.items);
  }
  if (out.anyOf?.length) {
    out.anyOf = out.anyOf.map((branch) =>
      normalizeMcpPropertyType({ ...branch, anyOf: undefined })
    );
  }
  if (out.properties) {
    const props: Record<string, PropertySchema> = {};
    for (const [key, val] of Object.entries(out.properties)) {
      props[key] = normalizeMcpPropertyType(val);
    }
    out.properties = props;
  }
  return out;
}

/** Rewrite integer→number and register alias keys so models pass validation. */
export function expandMcpToolProperties(
  properties: Record<string, PropertySchema>
): Record<string, PropertySchema> {
  const out: Record<string, PropertySchema> = {};
  for (const [key, raw] of Object.entries(properties)) {
    out[key] = normalizeMcpPropertyType(raw);
  }
  for (const [canonical, aliases] of Object.entries(MCP_FIELD_ALIASES)) {
    const base = out[canonical];
    if (!base) continue;
    for (const alias of aliases) {
      if (!(alias in out)) {
        out[alias] = {
          ...base,
          description: base.description
            ? `${base.description} (alias for ${canonical})`
            : `Alias for ${canonical}.`,
        };
      }
    }
  }
  return out;
}
