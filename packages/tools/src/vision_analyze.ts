import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { resolveVisionProviderConfig, withProviderRequestSpacing, effectiveHarnessEnvRaw } from "@liminal/core";
import { defineTool } from "./helpers.js";

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function sleep(ms: number) {
  return new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));
}

function normalizeImageInput(input: string): string {
  const t = input.trim();
  if (t.startsWith("data:image/")) return t;
  return resolve(t);
}

async function imageToDataUrl(pathOrDataUrl: string, maxBytes: number): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (pathOrDataUrl.startsWith("data:image/")) {
    return { ok: true, dataUrl: pathOrDataUrl };
  }
  const ext = extname(pathOrDataUrl).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) {
    return { ok: false, error: `Unsupported image format "${ext}". Supported: ${Object.keys(MIME_MAP).join(", ")}` };
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(pathOrDataUrl);
  } catch (err) {
    return { ok: false, error: `Failed to read image: ${String(err)}` };
  }
  if (bytes.length > maxBytes) {
    return { ok: false, error: `Image too large (${Math.round(bytes.length / 1024)} KB). Max bytes: ${maxBytes}` };
  }
  return { ok: true, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

export const visionAnalyzeTool = defineTool({
  name: "vision_analyze",
  description:
    "WHAT: Use a sidecar vision model to analyze an image while keeping Owl as the main reasoning model.\n" +
    "WHEN: Screenshot/UI/chart/OCR/image understanding would improve answer quality.\n" +
    "ARGS: image (path or data URL), prompt (analysis objective), detail (low|high, optional).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      image: { type: "string", description: "Image path (local) or data:image URL" },
      prompt: { type: "string", description: "What to analyze from the image" },
      detail: { type: "string", description: "Optional detail level: low|high" },
    },
    required: ["image", "prompt"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const imageInput = normalizeImageInput(String(args["image"] ?? ""));
    const prompt = String(args["prompt"] ?? "").trim();
    const detail = String(args["detail"] ?? "high").toLowerCase() === "low" ? "low" : "high";
    if (!prompt) return { ok: false, error: "prompt is required" };

    const provider = resolveVisionProviderConfig();
    const timeoutMs = Math.max(3000, parseInt(effectiveHarnessEnvRaw("AGENT_VISION_TIMEOUT_MS") ?? "15000", 10) || 15000);
    const maxBytes = Math.max(128_000, parseInt(effectiveHarnessEnvRaw("AGENT_VISION_MAX_IMAGE_BYTES") ?? String(4 * 1024 * 1024), 10) || 4 * 1024 * 1024);
    const retries = Math.max(0, parseInt(effectiveHarnessEnvRaw("AGENT_VISION_RETRIES") ?? "2", 10) || 2);
    const retryBaseMs = Math.max(250, parseInt(effectiveHarnessEnvRaw("AGENT_VISION_RETRY_BASE_MS") ?? "800", 10) || 800);

    const dataUrl = await imageToDataUrl(imageInput, maxBytes);
    if (!dataUrl.ok) return dataUrl;

    let lastErr = "vision model call failed";
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await withProviderRequestSpacing(
          { apiKey: provider.apiKey, baseURL: provider.baseURL },
          () =>
            fetch(`${provider.baseURL.replace(/\/$/, "")}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${provider.apiKey}`,
                "HTTP-Referer": "https://github.com/liminal-ai",
                "X-Title": "Liminal-vision-sidecar",
              },
              body: JSON.stringify({
                model: provider.model,
                temperature: 0.1,
                max_tokens: 900,
                response_format: { type: "json_object" },
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a vision extraction sidecar. Return strict JSON only with keys: caption, entities, text_ocr, layout, confidence, uncertainty_notes.",
                  },
                  {
                    role: "user",
                    content: [
                      { type: "text", text: `${prompt}\nReturn concise, grounded observations only.` },
                      { type: "image_url", image_url: { url: dataUrl.dataUrl, detail } },
                    ],
                  },
                ],
              }),
              signal: controller.signal,
            })
        );
        clearTimeout(tid);
        if (!res.ok) {
          lastErr = `HTTP ${res.status}`;
          if (attempt < retries && (res.status === 429 || res.status >= 500)) {
            await sleep(retryBaseMs * Math.pow(2, attempt));
            continue;
          }
          return {
            ok: false,
            error: `vision_analyze failed (${lastErr}). Recoverable: continue without vision or retry later.`,
          };
        }
        const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const raw = json.choices?.[0]?.message?.content?.trim() ?? "{}";
        let parsed: Record<string, unknown>;
        try {
          parsed = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          parsed = { caption: raw.slice(0, 600), confidence: "low", uncertainty_notes: "Non-JSON sidecar output normalized." };
        }
        const output = {
          caption: String(parsed["caption"] ?? ""),
          entities: Array.isArray(parsed["entities"]) ? parsed["entities"] : [],
          text_ocr: Array.isArray(parsed["text_ocr"]) ? parsed["text_ocr"] : [],
          layout: parsed["layout"] ?? {},
          confidence: parsed["confidence"] ?? "med",
          uncertainty_notes: parsed["uncertainty_notes"] ?? [],
          sidecar_model: provider.model,
          degraded_mode: false,
        };
        return { ok: true, output: JSON.stringify(output, null, 2) };
      } catch (err) {
        clearTimeout(tid);
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < retries) {
          await sleep(retryBaseMs * Math.pow(2, attempt));
          continue;
        }
      }
    }

    return {
      ok: false,
      error:
        `vision_analyze exhausted retries: ${lastErr}. ` +
        `Recoverable: proceed without image evidence and mark confidence lower.`,
    };
  },
});

