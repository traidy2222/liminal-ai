export type NotionMode = "read_write" | "read_only";

export const NOTION_DEFAULT_MODE: NotionMode = "read_write";

/** Notion capabilities are set on the public integration; mode gates harness write tools. */
export function notionScopeForMode(mode: NotionMode): string {
  return mode === "read_only" ? "read_only" : "read_write";
}
