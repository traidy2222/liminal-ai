/**
 * upload_image — inject an image into the conversation for visual analysis.
 *
 * Reads an image file from disk, base64-encodes it, and appends it as a
 * vision content block directly into the agent's context window so the model
 * can see it on the very next response.
 *
 * Supports JPEG, PNG, GIF, WebP. Max recommended size: ~4 MB.
 */
import { readFile } from "node:fs/promises";
import { resolve, extname } from "node:path";
import type { AgentHarness } from "@liminal/core";
import { defineTool } from "../../shared/helpers.js";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB

export function createUploadImageTool(harness: AgentHarness) {
  return defineTool({
    name: "upload_image",
    description:
      "WHAT: Load an image file from disk and inject it into the conversation so the model can see it.\n" +
      "WHEN: The user provides a screenshot, diagram, mockup, chart, or any image to analyze.\n" +
      "NOT WHEN: The image is already a URL — use web_fetch to download first if needed.\n" +
      "ARGS: path — absolute or relative path to the image file (JPEG, PNG, GIF, or WebP); " +
      "note — optional text note to include alongside the image (e.g. 'Please describe this UI mockup').",
    requiresApproval: false,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the image file" },
        note: {
          type: "string",
          description: "Optional note or question to include with the image",
        },
      },
      required: ["path"],
      additionalProperties: false,
    },
    handler: async (args) => {
      const filePath = resolve(args["path"] as string);
      const note = (args["note"] as string | undefined) ?? "";

      const ext = extname(filePath).toLowerCase();
      const mimeType = MIME_MAP[ext];
      if (!mimeType) {
        return {
          ok: false,
          error: `Unsupported image format "${ext}". Supported: ${Object.keys(MIME_MAP).join(", ")}`,
        };
      }

      let bytes: Buffer;
      try {
        bytes = await readFile(filePath);
      } catch (err) {
        return { ok: false, error: `Cannot read image file: ${String(err)}` };
      }

      if (bytes.length > MAX_BYTES) {
        return {
          ok: false,
          error: `Image too large (${(bytes.length / 1024 / 1024).toFixed(1)} MB). Max: 4 MB.`,
        };
      }

      const base64 = bytes.toString("base64");
      const dataUrl = `data:${mimeType};base64,${base64}`;

      // Inject into context as a user message with an image_url content block
      // This is the OpenAI vision format, supported by most multimodal models
      const textPart = note || "Image attached. Please analyze it.";
      harness.getContext().append({
        role: "user",
        content: [
          { type: "text", text: textPart },
          { type: "image_url", image_url: { url: dataUrl } },
        ] as unknown as string, // cast: OpenAI SDK types are strict but this is valid
      });

      const kb = Math.round(bytes.length / 1024);
      return {
        ok: true,
        output:
          `Image injected into context: ${filePath}\n` +
          `Format: ${mimeType}  Size: ${kb} KB\n` +
          `The model will see this image on the next response.\n` +
          (note ? `Note: "${note}"` : ""),
      };
    },
  });
}
