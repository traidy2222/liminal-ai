import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { resolveVisionProviderConfig, withProviderRequestSpacing, effectiveHarnessEnvRaw, buildOpenRouterAttributionHeaders } from "@liminal/core";
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

function resolveImageArg(args: Record<string, unknown>): string {
  const raw = args["image"] ?? args["path"] ?? args["file"] ?? "";
  return String(raw).trim();
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

async function readOpenRouterErrorBody(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { error?: { message?: string }; message?: string };
    const msg = j.error?.message ?? j.message;
    if (msg) return msg.slice(0, 500);
  } catch {
    /* ignore */
  }
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return "";
  }
}

function buildVisionRequestBody(options: {
  model: string;
  prompt: string;
  dataUrl: string;
  detail: "low" | "high";
  jsonMode: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: options.model,
    temperature: 0.1,
    max_tokens: 900,
    messages: [
      {
        role: "system",
        content:
          "You are a vision extraction sidecar. Return JSON with keys: caption, entities (array), text_ocr (array), layout (object), confidence (low|med|high), uncertainty_notes (array). No markdown fences.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: `${options.prompt}\nReturn concise, grounded observations only.` },
          { type: "image_url", image_url: { url: options.dataUrl, detail: options.detail } },
        ],
      },
    ],
  };
  if (options.jsonMode) {
    body["response_format"] = { type: "json_object" };
  }
  // Reasoning VL models on OpenRouter: disable extended thinking for fast caption/OCR sidecar.
  if (/reasoning/i.test(options.model)) {
    body["reasoning"] = { enabled: false };
  }
  return body;
}

export const visionAnalyzeTool = defineTool({
  name: "vision_analyze",
  description:
    "WHAT: Use a sidecar vision model to analyze an image while keeping Owl as the main reasoning model.\n" +
    "WHEN: Screenshot/UI/chart/OCR/image understanding would improve answer quality.\n" +
    "ARGS: image (path or data URL; alias: path), prompt (analysis objective), detail (low|high, optional).",
  requiresApproval: false,
  parameters: {
    type: "object",
    properties: {
      image: { type: "string", description: "Image path (local) or data:image URL" },
      path: { type: "string", description: "Alias for image — local file path" },
      prompt: { type: "string", description: "What to analyze from the image" },
      detail: { type: "string", description: "Optional detail level: low|high" },
    },
    required: ["prompt"],
    additionalProperties: false,
  },
  handler: async (args) => {
    const imageInput = resolve(resolveImageArg(args as Record<string, unknown>));
    const prompt = String(args["prompt"] ?? "").trim();
    const detail = String(args["detail"] ?? "high").toLowerCase() === "low" ? "low" : "high";
    if (!prompt) return { ok: false, error: "prompt is required" };
    if (!imageInput) {
      return {
        ok: false,
        error: "image (or path) is required — pass SCREENSHOT_PATH from browser tools as image=...",
      };
    }

    let provider: ReturnType<typeof resolveVisionProviderConfig>;
    try {
      provider = resolveVisionProviderConfig();
    } catch (err) {
      return {
        ok: false,
        error: `vision_analyze: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!provider.model?.trim()) {
      return {
        ok: false,
        error:
          "AGENT_VISION_MODEL is unset. Set it in Settings or .env (default: nvidia/nemotron-nano-12b-v2-vl:free on OpenRouter).",
      };
    }

    const timeoutMs = Math.max(
      3000,
      parseInt(effectiveHarnessEnvRaw("AGENT_VISION_TIMEOUT_MS") ?? "45000", 10) || 45_000
    );
    const maxBytes = Math.max(
      128_000,
      parseInt(effectiveHarnessEnvRaw("AGENT_VISION_MAX_IMAGE_BYTES") ?? String(4 * 1024 * 1024), 10) ||
        4 * 1024 * 1024
    );
    const retries = Math.max(0, parseInt(effectiveHarnessEnvRaw("AGENT_VISION_RETRIES") ?? "2", 10) || 2);
    const retryBaseMs = Math.max(250, parseInt(effectiveHarnessEnvRaw("AGENT_VISION_RETRY_BASE_MS") ?? "800", 10) || 800);

    const dataUrl = await imageToDataUrl(imageInput, maxBytes);
    if (!dataUrl.ok) return dataUrl;

    const endpoint = `${provider.baseURL.replace(/\/$/, "")}/chat/completions`;
    let lastErr = "vision model call failed";
    const jsonModes = [false, true] as const;

    for (let attempt = 0; attempt <= retries; attempt++) {
      for (const jsonMode of jsonModes) {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await withProviderRequestSpacing(
            { apiKey: provider.apiKey, baseURL: provider.baseURL },
            () =>
              fetch(endpoint, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${provider.apiKey}`,
                  ...buildOpenRouterAttributionHeaders("vision-sidecar"),
                },
                body: JSON.stringify(
                  buildVisionRequestBody({
                    model: provider.model,
                    prompt,
                    dataUrl: dataUrl.dataUrl,
                    detail,
                    jsonMode,
                  })
                ),
                signal: controller.signal,
              })
          );
          clearTimeout(tid);
          if (!res.ok) {
            const detailMsg = await readOpenRouterErrorBody(res);
            lastErr = `HTTP ${res.status}${detailMsg ? `: ${detailMsg}` : ""} (model=${provider.model})`;
            const retryable = res.status === 429 || res.status >= 500;
            const tryNextMode = res.status === 400 && jsonMode === true;
            if (tryNextMode) continue;
            if (attempt < retries && retryable) {
              await sleep(retryBaseMs * Math.pow(2, attempt));
              break;
            }
            if (!retryable && res.status === 400 && jsonMode === false) {
              return {
                ok: false,
                error:
                  `${lastErr}\n` +
                  "Hint: set AGENT_VISION_MODEL to a multimodal OpenRouter model (e.g. nvidia/nemotron-nano-12b-v2-vl:free) and AGENT_VISION_BASE_URL=https://openrouter.ai/api/v1 with a valid API key.",
              };
            }
            if (!retryable) {
              return {
                ok: false,
                error: `vision_analyze failed (${lastErr}). Recoverable: continue without vision or fix AGENT_VISION_* in Settings.`,
              };
            }
            continue;
          }
          const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
          const raw = json.choices?.[0]?.message?.content?.trim() ?? "{}";
          let parsed: Record<string, unknown>;
          try {
            const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
            parsed = JSON.parse(stripped) as Record<string, unknown>;
          } catch {
            parsed = {
              caption: raw.slice(0, 1200),
              confidence: "med",
              uncertainty_notes: ["Non-JSON sidecar output normalized."],
            };
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
        }
      }
      if (attempt < retries) {
        await sleep(retryBaseMs * Math.pow(2, attempt));
      }
    }

    return {
      ok: false,
      error:
        `vision_analyze exhausted retries: ${lastErr}. ` +
        `Check AGENT_VISION_MODEL (${provider.model}), AGENT_VISION_BASE_URL, and API key.`,
    };
  },
});
