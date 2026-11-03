/**
 * Copy remote MCP JSON schemas without changing their field names or types.
 * The dispatcher supports JSON Schema's integer and number types directly.
 */
import type { PropertySchema } from "./types.js";

/** Compatibility aliases, resolved only against a tool's declared remote fields. */
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
  displayName: ["display_name"],
  draftId: ["draft_id"],
  replyToMessageId: ["reply_to_message_id"],
  htmlBody: ["body_html", "html_body", "html"],
};

export function normalizeMcpPropertyType(schema: PropertySchema): PropertySchema {
  const out: PropertySchema = { ...schema };
  if (out.items) {
    out.items = normalizeMcpPropertyType(out.items);
  }
  if (out.anyOf?.length) {
    out.anyOf = out.anyOf.map(normalizeMcpPropertyType);
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

/** Copy properties without adding synthetic fields to the server contract. */
export function expandMcpToolProperties(
  properties: Record<string, PropertySchema>
): Record<string, PropertySchema> {
  const out: Record<string, PropertySchema> = {};
  for (const [key, raw] of Object.entries(properties)) {
    out[key] = normalizeMcpPropertyType(raw);
  }
  return out;
}
