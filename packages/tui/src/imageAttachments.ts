import { stat } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  normalizeImageAttachmentName,
  type ImageAttachment,
} from "@liminal/core";

const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export function parseAttachCommand(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed.toLowerCase().startsWith("/attach")) return null;
  const rest = trimmed.slice(7).trim();
  if (!rest) return "";
  return stripWrappingQuotes(rest);
}

export function extractImagePathsFromText(input: string): { paths: string[]; remainingText: string } {
  const lines = input.split(/\r?\n/);
  const paths: string[] = [];
  const remaining: string[] = [];
  for (const raw of lines) {
    const candidate = stripWrappingQuotes(raw.trim());
    if (looksLikeImagePath(candidate)) {
      paths.push(candidate);
      continue;
    }
    remaining.push(raw);
  }
  return { paths, remainingText: remaining.join("\n").trim() };
}

function looksLikeImagePath(value: string): boolean {
  if (!value) return false;
  const ext = extname(value).toLowerCase();
  return Boolean(EXT_TO_MIME[ext]);
}

function stripWrappingQuotes(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export async function imagePathToAttachment(pathInput: string): Promise<{ ok: true; attachment: ImageAttachment } | { ok: false; error: string }> {
  const absPath = resolve(pathInput);
  const ext = extname(absPath).toLowerCase();
  const mime = EXT_TO_MIME[ext];
  if (!mime) {
    return { ok: false, error: `Unsupported image path: ${pathInput}` };
  }
  let fileStat: Awaited<ReturnType<typeof stat>>;
  try {
    fileStat = await stat(absPath);
  } catch (err) {
    return { ok: false, error: `Failed to read image path "${pathInput}": ${String(err)}` };
  }
  if (!fileStat.isFile()) {
    return { ok: false, error: `Path is not a file: "${pathInput}"` };
  }
  return {
    ok: true,
    attachment: {
      name: normalizeImageAttachmentName(pathInput.split(/[\\/]/).at(-1) ?? "image"),
      mimeType: mime,
      filePath: absPath,
      sizeBytes: Math.max(0, fileStat.size),
      source: "path",
    },
  };
}
