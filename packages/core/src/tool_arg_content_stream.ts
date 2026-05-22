/**
 * Incremental extractor for `content` string values inside streaming tool-call JSON.
 * Scoped to {"path":"...","content":"..."} shapes used by write_file.
 */

export type ContentStreamParseState = {
  path: string | null;
  /** Decoded content accumulated so far (complete segments only). */
  contentEmittedLen: number;
  raw: string;
};

export function createContentStreamParseState(): ContentStreamParseState {
  return { path: null, contentEmittedLen: 0, raw: "" };
}

function tryExtractPath(raw: string): string | null {
  return tryExtractJsonStringField(raw, "path");
}

/** Best-effort decode of a completed JSON string property value. */
export function tryExtractJsonStringField(raw: string, fieldName: string): string | null {
  const m = new RegExp(`"${fieldName}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`).exec(raw);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1]!.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
}

export type PartialJsonStringField = {
  value: string;
  /** Field key seen in raw JSON. */
  started: boolean;
  /** Closing quote seen (stream may still be incomplete at tool level). */
  closed: boolean;
};

/** Decode a JSON string field from partial tool-call args (streaming-safe). */
export function decodePartialJsonStringField(raw: string, fieldName: string): PartialJsonStringField {
  const contentKey = `"${fieldName}"`;
  const keyIdx = raw.indexOf(contentKey);
  if (keyIdx < 0) return { value: "", started: false, closed: false };

  let i = keyIdx + contentKey.length;
  while (i < raw.length && /[\s:]/.test(raw[i]!)) i++;
  if (raw[i] !== '"') return { value: "", started: true, closed: false };

  const start = i + 1;
  let j = start;
  while (j < raw.length) {
    const c = raw[j]!;
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === '"') {
      return {
        value: decodeJsonStringBody(raw.slice(start, j)),
        started: true,
        closed: true,
      };
    }
    j++;
  }
  return {
    value: decodeJsonStringBody(raw.slice(start)),
    started: true,
    closed: false,
  };
}

/**
 * Decode JSON string body (without surrounding quotes). Handles standard escapes.
 */
function decodeJsonStringBody(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const c = body[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = body[++i];
    if (n === undefined) break;
    switch (n) {
      case '"':
        out += '"';
        break;
      case "\\":
        out += "\\";
        break;
      case "/":
        out += "/";
        break;
      case "b":
        out += "\b";
        break;
      case "f":
        out += "\f";
        break;
      case "n":
        out += "\n";
        break;
      case "r":
        out += "\r";
        break;
      case "t":
        out += "\t";
        break;
      case "u": {
        const hex = body.slice(i + 1, i + 5);
        if (hex.length === 4) {
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        }
        break;
      }
      default:
        out += n;
    }
  }
  return out;
}

/**
 * Returns newly decoded content chars since last call (may be empty).
 */
export function ingestToolArgJsonDelta(
  state: ContentStreamParseState,
  delta: string
): { path: string | null; newContent: string } {
  state.raw += delta;
  if (!state.path) {
    const p = tryExtractPath(state.raw);
    if (p) state.path = p;
  }

  const partial = decodePartialJsonStringField(state.raw, "content");
  if (!partial.started) return { path: state.path, newContent: "" };

  const decoded = partial.value;
  if (decoded.length <= state.contentEmittedLen) {
    return { path: state.path, newContent: "" };
  }
  const slice = decoded.slice(state.contentEmittedLen);
  state.contentEmittedLen = decoded.length;
  return { path: state.path, newContent: slice };
}

export function getEstimatedContentLength(state: ContentStreamParseState): number {
  return state.contentEmittedLen;
}

/** Full decoded content string from raw args JSON (best-effort). */
export function getDecodedContentFromRaw(state: ContentStreamParseState): string {
  return decodePartialJsonStringField(state.raw, "content").value;
}
