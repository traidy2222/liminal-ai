import type { PersonaSoulBundle } from "./persona_generator.js";

/** Unescape a partial JSON string value (best-effort for streaming previews). */
export function unescapePartialJsonString(raw: string): string {
  return raw
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Extract in-progress value for `"fieldName": "..."` from a partial JSON buffer.
 * Returns null if the field has not started yet.
 */
export function extractPartialJsonStringField(buffer: string, fieldName: string): string | null {
  const needle = `"${fieldName}"`;
  const idx = buffer.indexOf(needle);
  if (idx < 0) return null;
  let i = idx + needle.length;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== ":") return null;
  i++;
  while (i < buffer.length && /\s/.test(buffer[i]!)) i++;
  if (buffer[i] !== '"') return null;
  i++;

  let out = "";
  let escaped = false;
  while (i < buffer.length) {
    const ch = buffer[i]!;
    if (escaped) {
      out += ch === "n" ? "\n" : ch === "r" ? "\r" : ch === "t" ? "\t" : ch === '"' ? '"' : ch === "\\" ? "\\" : ch;
      escaped = false;
      i++;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      i++;
      continue;
    }
    if (ch === '"') break;
    out += ch;
    i++;
  }
  return unescapePartialJsonString(out);
}

export function extractPartialSoulBatch(buffer: string): Partial<PersonaSoulBundle> {
  const out: Partial<PersonaSoulBundle> = {};
  const identity = extractPartialJsonStringField(buffer, "identityMd");
  const voice = extractPartialJsonStringField(buffer, "voiceMd");
  const stance = extractPartialJsonStringField(buffer, "stanceMd");
  const rails = extractPartialJsonStringField(buffer, "railsMd");
  if (identity !== null) out.identityMd = identity;
  if (voice !== null) out.voiceMd = voice;
  if (stance !== null) out.stanceMd = stance;
  if (rails !== null) out.railsMd = rails;
  return out;
}

/** Short preview while profile JSON streams (name + coreIdentity when available). */
export function extractPartialProfilePreview(buffer: string): string {
  const name = extractPartialJsonStringField(buffer, "name");
  const core = extractPartialJsonStringField(buffer, "coreIdentity");
  const lines: string[] = [];
  if (name) lines.push(`"name": ${JSON.stringify(name)}`);
  if (core) lines.push(`"coreIdentity": ${JSON.stringify(core.slice(0, 400))}${core.length > 400 ? "…" : ""}`);
  if (lines.length > 0) return `{\n  ${lines.join(",\n  ")}\n}`;
  const tail = buffer.trim();
  if (tail.length > 0) return tail.slice(-1200);
  return "";
}
