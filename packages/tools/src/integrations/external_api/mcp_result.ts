import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { globalPath } from "@liminal/core";

export interface McpCallResult {
  content?: Array<{ type: string; text?: string; data?: string; mimeType?: string; [key: string]: unknown }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Keep Evidence/structured results and preserve media bytes outside the prompt. */
export async function renderMcpResult(result: McpCallResult, connection: string): Promise<string> {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (block.type === "text" && typeof block.text === "string") { parts.push(block.text); continue; }
    if ((block.type === "image" || block.type === "audio") && typeof block.data === "string") {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(block.data) || block.data.length % 4 !== 0) throw new Error("Invalid MCP media encoding");
      const bytes = Buffer.from(block.data, "base64");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const extensions: Record<string, string> = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "audio/wav": ".wav", "audio/mpeg": ".mp3" };
      const dir = globalPath("mcp_artifacts", connection.replace(/[^a-z0-9_-]/gi, "_"));
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, sha256 + (extensions[block.mimeType ?? ""] ?? ".bin"));
      await writeFile(file, bytes);
      parts.push(JSON.stringify({ type: block.type, mimeType: block.mimeType, path: file, sha256, bytes: bytes.length }));
      continue;
    }
    // Resource references are data: preserve them without fetching their URLs.
    parts.push(JSON.stringify(block));
  }
  if (result.structuredContent) {
    const structured = JSON.stringify(result.structuredContent);
    const alreadyPresent = parts.some(text => { try { return JSON.stringify(JSON.parse(text)) === structured; } catch { return false; } });
    if (!alreadyPresent) parts.push(structured);
  }
  return parts.join("\n").trim() || "[empty MCP response]";
}
