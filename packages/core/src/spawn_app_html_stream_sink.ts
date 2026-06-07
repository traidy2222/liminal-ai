import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ensurePerChatDirSync } from "./global_storage.js";
import { isLikelyTruncatedFileContent } from "./file_write_resume.js";
import {
  decodePartialJsonStringField,
  tryExtractJsonStringField,
  type PartialJsonStringField,
} from "./tool_arg_content_stream.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";

const HTML_SINK_MIN_CHARS = 0;

type ContentKey = "html" | "markdown";

function propsScope(raw: string): string {
  const propsIdx = raw.indexOf('"props"');
  return propsIdx >= 0 ? raw.slice(propsIdx) : raw;
}

function decodeToolContent(raw: string): {
  key: ContentKey;
  partial: PartialJsonStringField;
} {
  const scoped = propsScope(raw);
  for (const key of ["html", "markdown"] as const) {
    const partial = decodePartialJsonStringField(scoped, key);
    if (partial.started) return { key, partial };
  }
  return { key: "html", partial: { value: "", started: false, closed: false } };
}

function looksLikeCompleteHtmlDocument(body: string): boolean {
  const t = body.trim().toLowerCase();
  return t.includes("</html>") || (t.includes("</body>") && t.includes("<html"));
}

function tryExtractPropsField(raw: string, fieldName: string): string | null {
  return tryExtractJsonStringField(propsScope(raw), fieldName);
}

type SinkEntry = {
  callId: string;
  toolName: string;
  raw: string;
  contentKey: ContentKey;
  contentFlushedLen: number;
  stagingPath: string;
  stream: ReturnType<typeof createWriteStream> | null;
  sinkActive: boolean;
  closed: boolean;
  writeFailed: boolean;
};

function inflightDir(chatId: string | null): string {
  if (chatId) {
    return ensurePerChatDirSync(chatId, "write_staging", "spawn_inflight");
  }
  return path.join(resolveWorkspaceRoot(), ".agent_write_staging", "spawn_inflight");
}

function stagingPathFor(callId: string, chatId: string | null): string {
  const safe = callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return path.join(inflightDir(chatId), `${safe}.html`);
}

/** Streams `props.html` / `props.markdown` from in-flight spawn_app / update_app tool JSON. */
export class SpawnAppHtmlStreamSink {
  private readonly entries = new Map<string, SinkEntry>();

  constructor(
    private readonly enabled: boolean,
    private readonly chatId: string | null = null
  ) {}

  open(callId: string, toolName: string): void {
    if (!this.enabled) return;
    if (!this.entries.has(callId)) {
      this.entries.set(callId, {
        callId,
        toolName,
        raw: "",
        contentKey: "html",
        contentFlushedLen: 0,
        stagingPath: stagingPathFor(callId, this.chatId),
        stream: null,
        sinkActive: false,
        closed: false,
        writeFailed: false,
      });
    }
  }

  async ingestDelta(callId: string, toolName: string, delta: string): Promise<void> {
    if (!this.enabled || !delta) return;
    this.open(callId, toolName);
    const entry = this.entries.get(callId);
    if (!entry || entry.closed || entry.writeFailed) return;

    entry.raw += delta;
    const { key, partial } = decodeToolContent(entry.raw);
    if (!partial.started) return;
    entry.contentKey = key;

    if (!entry.sinkActive && partial.value.length > HTML_SINK_MIN_CHARS) {
      entry.sinkActive = true;
    }

    if (entry.sinkActive && partial.value.length > entry.contentFlushedLen) {
      const slice = partial.value.slice(entry.contentFlushedLen);
      entry.contentFlushedLen = partial.value.length;
      await this.writeChunk(entry, slice);
    }
  }

  private async writeChunk(entry: SinkEntry, chunk: string): Promise<void> {
    await this.ensureStream(entry);
    if (!entry.stream || entry.closed) return;
    const ok = entry.stream.write(chunk, "utf8");
    if (!ok) {
      await new Promise<void>((resolve, reject) => {
        entry.stream!.once("drain", resolve);
        entry.stream!.once("error", reject);
      });
    }
  }

  private async ensureStream(entry: SinkEntry): Promise<void> {
    if (entry.stream) return;
    await mkdir(inflightDir(this.chatId), { recursive: true });
    entry.stream = createWriteStream(entry.stagingPath, { encoding: "utf8", flags: "w" });
    entry.stream.on("error", () => {
      entry.writeFailed = true;
    });
  }

  async finalize(callId: string): Promise<void> {
    const entry = this.entries.get(callId);
    if (!entry || entry.closed) return;

    const { partial } = decodeToolContent(entry.raw);
    if (partial.value.length > entry.contentFlushedLen) {
      const tail = partial.value.slice(entry.contentFlushedLen);
      entry.contentFlushedLen = partial.value.length;
      if (tail.length > 0) {
        if (!entry.sinkActive) entry.sinkActive = true;
        await this.writeChunk(entry, tail);
      }
    }

    entry.closed = true;
    if (entry.stream) {
      await new Promise<void>((resolve, reject) => {
        entry.stream!.end(() => resolve());
        entry.stream!.once("error", reject);
      });
    }
  }

  discard(callId: string): void {
    const entry = this.entries.get(callId);
    if (!entry) return;
    entry.closed = true;
    entry.stream?.destroy();
    void rm(entry.stagingPath, { force: true });
    this.entries.delete(callId);
  }

  hasActiveIngest(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.closed || entry.writeFailed) continue;
      if (entry.sinkActive || entry.raw.length > 0) return true;
    }
    return false;
  }

  private async readStagedContent(entry: SinkEntry): Promise<string> {
    if (entry.sinkActive) {
      try {
        return await readFile(entry.stagingPath, "utf8");
      } catch {
        /* fall through */
      }
    }
    return decodeToolContent(entry.raw).partial.value;
  }

  private buildPropsPayload(entry: SinkEntry, body: string): Record<string, unknown> {
    const props: Record<string, unknown> = { [entry.contentKey]: body };
    if (entry.contentKey === "html") {
      props["interactivity"] = "sandbox";
      const inter = tryExtractPropsField(entry.raw, "interactivity");
      if (inter === "static") props["interactivity"] = "static";
    }
    return props;
  }

  /** Build valid tool JSON when the provider ended mid-string (length limit). */
  async tryBuildArgsJson(callId: string): Promise<string | null> {
    const entry = this.entries.get(callId);
    if (!entry) return null;

    const body = (await this.readStagedContent(entry)).trim();
    if (body.length < 8) return null;

    const { partial } = decodeToolContent(entry.raw);
    if (partial.started && !partial.closed && isLikelyTruncatedFileContent(body)) {
      const stagedOk =
        entry.sinkActive &&
        (partial.closed || looksLikeCompleteHtmlDocument(body) || body.length >= 400);
      if (!stagedOk) return null;
    }

    const props = this.buildPropsPayload(entry, body);

    if (entry.toolName === "update_app") {
      const id = tryExtractJsonStringField(entry.raw, "id");
      if (!id) return null;
      const payload: Record<string, unknown> = { id, props };
      const title = tryExtractJsonStringField(entry.raw, "title");
      if (title) payload["title"] = title;
      return JSON.stringify(payload);
    }

    const type = tryExtractJsonStringField(entry.raw, "type") ?? "html";
    const title = tryExtractJsonStringField(entry.raw, "title");
    const id = tryExtractJsonStringField(entry.raw, "id");
    const payload: Record<string, unknown> = { type, props };
    if (title) payload["title"] = title;
    if (id) payload["id"] = id;
    return JSON.stringify(payload);
  }

  buildLengthResumeHint(callId: string): string {
    const entry = this.entries.get(callId);
    if (!entry) return "";
    const { partial } = decodeToolContent(entry.raw);
    const chars = Math.max(partial.value.length, entry.contentFlushedLen);
    if (chars === 0) return "";
    const tool =
      entry.toolName === "update_app"
        ? "update_app with props.html (full document overwrite)"
        : "spawn_app with props.html (one complete <!DOCTYPE html> document)";
    return ` Partial widget body (${chars} chars) staged at ${entry.stagingPath} — continue with ${tool}.`;
  }

  async stagedByteCount(callId: string): Promise<number> {
    const entry = this.entries.get(callId);
    if (!entry) return 0;
    try {
      const s = await stat(entry.stagingPath);
      return s.size;
    } catch {
      return decodeToolContent(entry.raw).partial.value.length;
    }
  }

  async readStagedContentForDispatch(callId: string): Promise<{
    key: ContentKey;
    body: string;
  } | null> {
    const entry = this.entries.get(callId);
    if (!entry) return null;
    const body = (await this.readStagedContent(entry)).trim();
    if (!body) return null;
    return { key: entry.contentKey, body };
  }

  takeEntry(callId: string): void {
    this.entries.delete(callId);
  }
}

export function resolveSpawnAppHtmlStreamSinkEnabled(): boolean {
  return true;
}
