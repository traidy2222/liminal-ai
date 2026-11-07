/**
 * Native multimodal vision — route user image attachments as `image_url` parts on the
 * main chat model when the slug supports text+image input (OpenAI-compatible format).
 */
import { readFile } from "node:fs/promises";
import type { ChatCompletionContentPart } from "openai/resources/chat/completions.js";
import { effectiveHarnessEnvRaw } from "./harness_effective_env.js";
import type { ImageAttachment } from "./image_attachments.js";
import type {Message} from './types.js';

export type NativeVisionResolution = {
  enabled: boolean;
  source: "slug_list" | "slug_heuristic" | "catalog" | "off";
};
const catalogVision=new Map<string,boolean>();

function slugMatchesList(slug: string, csv: string | undefined): boolean {
  if (!csv?.trim()) return false;
  const lower = slug.toLowerCase();
  for (const part of csv.split(",")) {
    const p = part.trim().toLowerCase();
    if (p && lower.includes(p)) return true;
  }
  return false;
}

/** Known OpenRouter slugs that accept image_url parts on the chat completions API. */
function slugMatchesNativeVisionHeuristic(slug: string): boolean {
  const s = slug.toLowerCase();
  if (s.includes("nex-n2-pro") || s.includes("nex-agi/")) return true;
  if (s.includes("deepseek-v4.1-flash") || s.includes("deepseek-v4-flash-vision")) return true;
  if (s.includes("gemini") && !s.includes("embedding")) return true;
  if (s.includes("gpt-4o") || s.includes("gpt-5")) return true;
  if (s.includes("claude") && (s.includes("opus") || s.includes("sonnet") || s.includes("haiku"))) {
    return true;
  }
  if (/nemotron.*vl|vl:free/i.test(s)) return true;
  if (s.includes("llama-4")) return true;
  if (s.includes("qwen") && (s.includes("vl") || s.includes("vision"))) return true;
  return false;
}

export function resolveNativeVision(modelSlug: string): NativeVisionResolution {
  if (effectiveHarnessEnvRaw("AGENT_NATIVE_VISION")?.trim() === "0") {
    return { enabled: false, source: "off" };
  }
  const csv = effectiveHarnessEnvRaw("AGENT_NATIVE_VISION_SLUGS");
  if (slugMatchesList(modelSlug, csv)) {
    return { enabled: true, source: "slug_list" };
  }
  if(catalogVision.has(modelSlug))return {enabled:catalogVision.get(modelSlug)!,source:'catalog'};
  if (slugMatchesNativeVisionHeuristic(modelSlug)) {
    return { enabled: true, source: "slug_heuristic" };
  }
  return { enabled: false, source: "off" };
}

export function modelSupportsNativeVision(modelSlug: string): boolean {
  return resolveNativeVision(modelSlug).enabled;
}

/** Switching to a text-only model preserves history while omitting unsupported pixels. */
export function omitUnsupportedImagePixels(messages:Message[]):Message[]{
 return messages.map(message=>{
  if(message.role!=='user'||!Array.isArray(message.content))return message;
  return {...message,content:message.content.map(part=>part.type==='image_url'?{type:'text' as const,text:'[Image pixels omitted: the selected model does not support native image input.]'}:part)};
 });
}

/** Resolve unknown OpenRouter models from advertised modalities, with the shared catalog cache. */
export async function modelSupportsNativeVisionAsync(modelSlug:string,baseURL?:string):Promise<boolean>{
 const known=resolveNativeVision(modelSlug);
 if(known.enabled||known.source==='catalog'||effectiveHarnessEnvRaw('AGENT_NATIVE_VISION')==='0')return known.enabled;
 if(!baseURL||!/^https:\/\/openrouter\.ai(?:\/|$)/i.test(baseURL))return false;
 try{
  const {fetchOpenRouterSettingsCatalog}=await import('./openrouter_catalog.js');
  const models=await fetchOpenRouterSettingsCatalog();
  for(const model of models)catalogVision.set(model.id,model.inputModalities.includes('image'));
 }catch{/* Unknown capability stays disabled; never silently call another model. */}
 return resolveNativeVision(modelSlug).enabled;
}

async function attachmentDataUrl(att: ImageAttachment): Promise<string | null> {
  if (att.dataUrl?.startsWith("data:image/")) return att.dataUrl;
  if (!att.filePath) return null;
  try {
    const buf = await readFile(att.filePath);
    return `data:${att.mimeType};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Build OpenAI-compatible multimodal user content for the main model. */
export async function buildNativeVisionUserContent(
  message: string,
  attachments: ImageAttachment[]
): Promise<ChatCompletionContentPart[]> {
  const trimmed = message.trim();
  const text =
    trimmed ||
    (attachments.length === 1 ? "Please analyze this image." : "Please analyze these images.");
  const parts: ChatCompletionContentPart[] = [{ type: "text", text }];
  for (const att of attachments) {
    const url = await attachmentDataUrl(att);
    if (!url) continue;
    parts.push({
      type: "image_url",
      image_url: { url, detail: "auto" },
    });
  }
  return parts;
}
