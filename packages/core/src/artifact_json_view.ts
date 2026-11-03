/** Bounded own-property JSON views over archived tool output. No evaluation,
 * JSONPath expressions, prototype traversal or implicit wrapper assumptions.
 */
import { MAX_ARTIFACT_BYTES, readArtifactText } from "./output_distill.js";
import type { ToolResult } from "./types.js";

export const MAX_ARTIFACT_JSON_VIEW_BYTES = 24_000;

export interface ArtifactJsonViewOptions {
  view: "keys" | "value";
  jsonPointer?: string;
  offset?: number;
  /** Arrays/keys: maximum 200; strings: maximum 20000 Unicode code points. */
  limit?: number;
  signal?: AbortSignal;
}

export function isValidArtifactHash(hash: string): boolean {
  return typeof hash === "string" && /^[a-f0-9]{1,128}$/i.test(hash);
}

function numberOption(
  value: unknown,
  fallback: number,
  max: number,
  name: string,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > max
  )
    throw new Error(`${name} must be an integer from 0 to ${max}`);
  return value;
}

function limitOption(value: unknown, fallback: number, max: number): number {
  const limit = numberOption(value, fallback, max, "limit");
  if (limit === 0) throw new Error("limit must be at least 1");
  return limit;
}

function typeOf(value: unknown): string {
  return value === null
    ? "null"
    : Array.isArray(value)
      ? "array"
      : typeof value;
}

function ownKeys(value: unknown): {
  count: number;
  at: (index: number) => string;
} {
  if (Array.isArray(value))
    return { count: value.length, at: (index) => String(index) };
  const keys = value && typeof value === "object" ? Object.keys(value) : [];
  return { count: keys.length, at: (index) => keys[index]! };
}

function escapeToken(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function resolvePointer(root: unknown, pointer: string): unknown {
  if (
    typeof pointer !== "string" ||
    pointer.length > 4096 ||
    Buffer.byteLength(JSON.stringify(pointer), "utf8") > 4096
  )
    throw new Error(
      "json_pointer must be a plain RFC6901 pointer within 4096 serialized bytes",
    );
  if (pointer === "") return root;
  if (!pointer.startsWith("/"))
    throw new Error(
      "json_pointer must be empty for root or start with /; URI fragments and JSONPath are unsupported",
    );
  const tokens = pointer.slice(1).split("/");
  if (tokens.length > 64)
    throw new Error("json_pointer exceeds 64 path tokens");
  let selected = root;
  for (const encoded of tokens) {
    if (/~(?:[^01]|$)/.test(encoded))
      throw new Error(
        "json_pointer has an invalid ~ escape; only ~0 and ~1 are supported",
      );
    const token = encoded.replace(/~([01])/g, (_, value) =>
      value === "0" ? "~" : "/",
    );
    if (Array.isArray(selected)) {
      if (!/^(?:0|[1-9][0-9]*)$/.test(token))
        throw new Error(
          "JSON array indices must be canonical nonnegative integers; append/dash and leading zeros are unsupported",
        );
      const index = Number(token);
      if (
        !Number.isSafeInteger(index) ||
        index >= selected.length ||
        !Object.hasOwn(selected, index)
      )
        throw new Error("json_pointer array index was not found");
      selected = selected[index];
    } else if (
      selected !== null &&
      typeof selected === "object" &&
      Object.hasOwn(selected, token)
    ) {
      selected = (selected as Record<string, unknown>)[token];
    } else
      throw new Error(
        "json_pointer own-property path was not found; inspect view=keys at the actual root or its parent",
      );
  }
  return selected;
}

function rootKeyPreview(root: unknown) {
  const keys = ownKeys(root),
    preview: string[] = [];
  for (let i = 0; i < Math.min(keys.count, 32); i++) {
    const key = keys.at(i);
    if (Buffer.byteLength(JSON.stringify([...preview, key]), "utf8") > 2048)
      break;
    preview.push(key);
  }
  return {
    root_type: typeOf(root),
    root_keys: preview,
    root_key_count: keys.count,
    root_keys_truncated: preview.length < keys.count,
  };
}

function serialize(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => {
      if (typeof item === "number" && !Number.isFinite(item))
        throw new Error(
          "Selected JSON contains a non-finite numeric representation and cannot be rendered faithfully",
        );
      return item;
    },
    2,
  );
}

function fits(output: string): boolean {
  return Buffer.byteLength(output, "utf8") <= MAX_ARTIFACT_JSON_VIEW_BYTES;
}

/** Pure selection helper; source-size cap also applies to direct callers. */
export function selectArtifactJsonView(
  raw: string,
  options: ArtifactJsonViewOptions,
  artifactHash?: string,
): ToolResult {
  try {
    options.signal?.throwIfAborted();
    if (Buffer.byteLength(raw, "utf8") > MAX_ARTIFACT_BYTES)
      throw new Error(
        `Artifact JSON exceeds the ${MAX_ARTIFACT_BYTES}-byte load cap; request a smaller upstream artifact`,
      );
    if (options.view !== "keys" && options.view !== "value")
      throw new Error("JSON view must explicitly be keys or value");
    let root: unknown;
    try {
      root = JSON.parse(raw);
    } catch {
      throw new Error(
        "Artifact is not valid JSON; use the existing text/line view or request structured provider output",
      );
    }
    options.signal?.throwIfAborted();
    const pointer = options.jsonPointer === undefined ? "" : options.jsonPointer;
    const selected = resolvePointer(root, pointer);
    const offset = numberOption(
      options.offset,
      0,
      Number.MAX_SAFE_INTEGER,
      "offset",
    );
    if (options.limit !== undefined) limitOption(options.limit, 20, 20_000);
    const base = {
      ...(artifactHash ? { artifact_hash: artifactHash } : {}),
      view: options.view,
      json_pointer: pointer,
      ...rootKeyPreview(root),
      selected_type: typeOf(selected),
      output_budget_bytes: MAX_ARTIFACT_JSON_VIEW_BYTES,
    };
    const wrap = (value: Record<string, unknown>) =>
      serialize({ ...base, ...value });
    const done = (output: string): ToolResult => {
      if (!fits(output))
        throw new Error(
          "JSON view metadata exceeds the bounded output budget; use a shorter pointer",
        );
      return { ok: true, output };
    };
    const drill = (
      value: unknown,
      drillPointer: string,
      total: number,
      reason: string,
    ): ToolResult => {
      const keys = ownKeys(value),
        pointers: Array<{ key: string; json_pointer: string }> = [];
      for (let i = 0; i < Math.min(keys.count, 16); i++) {
        const key = keys.at(i),
          child = { key, json_pointer: `${drillPointer}/${escapeToken(key)}` };
        if (
          Buffer.byteLength(JSON.stringify([...pointers, child]), "utf8") > 4096
        )
          break;
        pointers.push(child);
      }
      return done(
        wrap({
          status: "drill_required",
          offset,
          selected_count: 0,
          total_count: total,
          next_offset: offset,
          drill_pointer: drillPointer,
          drill_keys: pointers,
          reason,
          next_action:
            "Use the drill_pointer or one returned child json_pointer; strings page automatically in value view. Do not advance the offset past an undisplayed item.",
        }),
      );
    };

    if (options.view === "keys") {
      if (!selected || typeof selected !== "object")
        throw new Error(
          "keys view requires an object or array; use value for scalars/strings",
        );
      const keys = ownKeys(selected),
        limit = limitOption(options.limit, 64, 200);
      if (offset > keys.count)
        throw new Error("offset is past the selected key count");
      const page: Array<{ key: string; json_pointer: string }> = [];
      for (let i = offset; i < Math.min(keys.count, offset + limit); i++) {
        const key = keys.at(i);
        page.push({ key, json_pointer: `${pointer}/${escapeToken(key)}` });
        const output = wrap({
          status: "page",
          offset,
          limit,
          selected_count: page.length,
          total_count: keys.count,
          next_offset: i + 1 < keys.count ? i + 1 : null,
          keys: page,
        });
        if (!fits(output)) {
          page.pop();
          break;
        }
      }
      if (!page.length && offset < keys.count)
        return drill(
          selected,
          pointer,
          keys.count,
          "The first selected key cannot fit the serialized output budget; inspect a narrower node or use raw text",
        );
      return done(
        wrap({
          status: "page",
          offset,
          limit,
          selected_count: page.length,
          total_count: keys.count,
          next_offset:
            offset + page.length < keys.count ? offset + page.length : null,
          keys: page,
        }),
      );
    }
    if (Array.isArray(selected)) {
      const limit = limitOption(options.limit, 20, 200);
      if (offset > selected.length)
        throw new Error("offset is past the selected array length");
      const page: unknown[] = [];
      for (let i = offset; i < Math.min(selected.length, offset + limit); i++) {
        page.push(selected[i]);
        let output: string;
        try {
          output = wrap({
            status: "page",
            offset,
            limit,
            selected_count: page.length,
            total_count: selected.length,
            next_offset: i + 1 < selected.length ? i + 1 : null,
            value: page,
          });
        } catch {
          page.pop();
          break;
        }
        if (!fits(output)) {
          page.pop();
          break;
        }
      }
      if (!page.length && offset < selected.length)
        return drill(
          selected[offset],
          `${pointer}/${offset}`,
          selected.length,
          "The first selected array item exceeds the JSON output/serialization budget. Drill into this exact item instead of dropping or clipping it",
        );
      return done(
        wrap({
          status: "page",
          offset,
          limit,
          selected_count: page.length,
          total_count: selected.length,
          next_offset:
            offset + page.length < selected.length
              ? offset + page.length
              : null,
          value: page,
        }),
      );
    }
    if (typeof selected === "string") {
      const limit = limitOption(options.limit, 8000, 20_000),
        characters: string[] = [];
      let total = 0;
      for (const character of selected) {
        if (total >= offset && characters.length < limit)
          characters.push(character);
        total++;
      }
      if (offset > total)
        throw new Error(
          "offset is past the selected Unicode code-point length",
        );
      const render = (count: number) =>
        wrap({
          status: "page",
          offset,
          limit,
          offset_unit: "unicode_code_points",
          selected_count: count,
          total_count: total,
          next_offset: offset + count < total ? offset + count : null,
          value: characters.slice(0, count).join(""),
        });
      const fullPage = render(characters.length);
      if (fits(fullPage)) return done(fullPage);
      let lower = 0,
        upper = characters.length;
      while (lower < upper) {
        const middle = Math.ceil((lower + upper) / 2);
        if (fits(render(middle))) lower = middle;
        else upper = middle - 1;
      }
      if (!lower && characters.length)
        return drill(
          selected,
          pointer,
          total,
          "String page metadata cannot fit; use a shorter pointer",
        );
      return done(render(lower));
    }
    if (offset !== 0)
      throw new Error(
        "offset applies only to array/string value pages or keys view",
      );
    try {
      const output = wrap({
        status: "value",
        offset: 0,
        selected_count: 1,
        total_count: 1,
        next_offset: null,
        value: selected,
      });
      if (fits(output)) return done(output);
    } catch {
      /* Explicit drill guidance replaces serialization loss/truncation. */
    }
    return drill(
      selected,
      pointer,
      1,
      "The selected object/scalar cannot fit a faithful bounded JSON value; inspect its own keys and select a child",
    );
  } catch (error) {
    return {
      ok: false,
      error: `read_artifact JSON view: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export async function readArtifactJsonView(
  hash: string,
  options: ArtifactJsonViewOptions,
): Promise<ToolResult> {
  if (!isValidArtifactHash(hash))
    return {
      ok: false,
      error: "read_artifact: invalid hash; expected 1..128 hex characters",
    };
  try {
    options.signal?.throwIfAborted();
    const source = await readArtifactText(hash);
    if (!source.ok)
      return {
        ok: false,
        error: source.error.startsWith("Artifact too large")
          ? `${source.error.split(" Use ")[0]} JSON selection cannot bypass the ${MAX_ARTIFACT_BYTES}-byte load cap; request smaller upstream pages/filters.`
          : source.error,
      };
    options.signal?.throwIfAborted();
    return selectArtifactJsonView(source.text, options, hash);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
