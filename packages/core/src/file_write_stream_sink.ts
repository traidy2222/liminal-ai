import { createWriteStream } from "node:fs";
import { appendFile, copyFile, mkdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { ensurePerChatDirSync } from "./global_storage.js";
import { resolveWorkspaceRoot } from "./workspace_root.js";
import { resolveHarnessEnvRaw } from "./harness_effective_env.js";
import type { RuntimePreferences } from "./runtime_prefs.js";
import {
  createContentStreamParseState,
  getDecodedContentFromRaw,
  ingestToolArgJsonDelta,
  tryExtractJsonStringField,
  type ContentStreamParseState,
} from "./tool_arg_content_stream.js";

export type FileWriteSinkMode = "create" | "append" | "overwrite";

type SinkEntry = {
  callId: string;
  toolName: string;
  parse: ContentStreamParseState;
  stagingPath: string;
  targetPath: string | null;
  mode: FileWriteSinkMode;
  stream: ReturnType<typeof createWriteStream> | null;
  bytesWritten: number;
  /** Decoded UTF-16 length already flushed to staging. */
  contentFlushedLen: number;
  closed: boolean;
  sinkActive: boolean;
  writeFailed: boolean;
};

export function resolveWriteStreamSinkEnabled(prefs: RuntimePreferences | null): boolean {
  return resolveHarnessEnvRaw("AGENT_WRITE_STREAM_SINK", prefs) === "1";
}

export function resolveWriteStreamSinkMinChars(prefs: RuntimePreferences | null): number {
  const raw = resolveHarnessEnvRaw("AGENT_WRITE_STREAM_SINK_MIN_CHARS", prefs) ?? "8000";
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 8000;
}

function inflightDir(chatId: string | null): string {
  if (chatId) {
    return ensurePerChatDirSync(chatId, "write_staging", "inflight");
  }
  return path.join(resolveWorkspaceRoot(), ".agent_write_staging", "inflight");
}

function stagingPathFor(callId: string, chatId: string | null): string {
  const safe = callId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  return path.join(inflightDir(chatId), `${safe}.tmp`);
}

function resolveTargetPath(p: string): string {
  if (path.isAbsolute(p)) return p;
  return path.resolve(resolveWorkspaceRoot(), p);
}

function parseSinkMode(raw: string | null): FileWriteSinkMode {
  if (raw === "append") return "append";
  if (raw === "overwrite") return "overwrite";
  return "create";
}

export class FileWriteStreamSink {
  private readonly entries = new Map<string, SinkEntry>();

  constructor(
    private readonly enabled: boolean,
    private readonly minChars: number,
    private readonly chatId: string | null = null
  ) {}

  open(callId: string, toolName: string): void {
    if (!this.enabled) return;
    if (!this.entries.has(callId)) {
      this.entries.set(callId, {
        callId,
        toolName,
        parse: createContentStreamParseState(),
        stagingPath: stagingPathFor(callId, this.chatId),
        targetPath: null,
        mode: "create",
        stream: null,
        bytesWritten: 0,
        contentFlushedLen: 0,
        closed: false,
        sinkActive: false,
        writeFailed: false,
      });
    }
  }

  async ingestDelta(callId: string, toolName: string, delta: string): Promise<void> {
    if (!this.enabled || !delta) return;
    this.open(callId, toolName);
    const entry = this.entries.get(callId);
    if (!entry || entry.closed || entry.writeFailed) return;

    ingestToolArgJsonDelta(entry.parse, delta);

    const parsedPath = entry.parse.path ?? tryExtractJsonStringField(entry.parse.raw, "path");
    if (parsedPath && !entry.targetPath) {
      entry.targetPath = resolveTargetPath(parsedPath);
      if (!entry.parse.path) entry.parse.path = parsedPath;
    }

    const modeRaw = tryExtractJsonStringField(entry.parse.raw, "mode");
    if (modeRaw) entry.mode = parseSinkMode(modeRaw);

    if (!entry.sinkActive && entry.parse.contentEmittedLen >= this.minChars) {
      entry.sinkActive = true;
    }

    if (entry.sinkActive && entry.targetPath) {
      await this.flushDecodedTail(entry);
    }
  }

  private async flushDecodedTail(entry: SinkEntry): Promise<void> {
    const decoded = getDecodedContentFromRaw(entry.parse);
    if (decoded.length <= entry.contentFlushedLen) return;
    const slice = decoded.slice(entry.contentFlushedLen);
    entry.contentFlushedLen = decoded.length;
    await this.writeChunk(entry, slice);
  }

  private async writeChunk(entry: SinkEntry, chunk: string): Promise<void> {
    await this.ensureStream(entry);
    if (!entry.stream || entry.closed) return;
    const ok = entry.stream.write(chunk, "utf8");
    entry.bytesWritten += Buffer.byteLength(chunk, "utf8");
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
    if (entry.stream) {
      entry.stream.destroy();
    }
    void rm(entry.stagingPath, { force: true });
    this.entries.delete(callId);
  }

  takeForDispatch(callId: string): {
    stagingPath: string;
    targetPath: string;
    mode: FileWriteSinkMode;
    bytesWritten: number;
  } | null {
    const entry = this.entries.get(callId);
    if (
      !entry ||
      entry.writeFailed ||
      !entry.sinkActive ||
      !entry.targetPath ||
      entry.bytesWritten === 0
    ) {
      return null;
    }
    this.entries.delete(callId);
    return {
      stagingPath: entry.stagingPath,
      targetPath: entry.targetPath,
      mode: entry.mode,
      bytesWritten: entry.bytesWritten,
    };
  }

  async getStagingByteCount(callId: string): Promise<number> {
    const entry = this.entries.get(callId);
    if (!entry) return 0;
    try {
      const s = await stat(entry.stagingPath);
      return s.size;
    } catch {
      return entry.bytesWritten;
    }
  }

  /** True while a file-write tool call is still streaming args into staging. */
  hasActiveIngest(): boolean {
    for (const entry of this.entries.values()) {
      if (entry.closed || entry.writeFailed) continue;
      if (entry.sinkActive || entry.parse.contentEmittedLen > 0) return true;
    }
    return false;
  }

  buildLengthResumeHint(callId: string): string {
    const entry = this.entries.get(callId);
    if (!entry?.targetPath || entry.bytesWritten === 0) return "";
    return ` Partial bytes (${entry.bytesWritten}) staged at ${entry.stagingPath} for ${entry.targetPath} — continue with write_file mode=append.`;
  }

  async salvagePartialToTarget(callId: string): Promise<{ targetPath: string; bytes: number } | null> {
    const entry = this.entries.get(callId);
    if (!entry?.targetPath || entry.bytesWritten === 0 || entry.writeFailed) return null;
    await this.finalize(callId);
    try {
      await mkdir(path.dirname(entry.targetPath), { recursive: true });
      if (entry.mode === "append") {
        let staged = await readFile(entry.stagingPath, "utf8");
        try {
          const prev = await readFile(entry.targetPath, "utf8");
          if (prev.length > 0 && !prev.endsWith("\n") && !staged.startsWith("\n")) {
            staged = "\n" + staged;
          }
        } catch {
          /* new file */
        }
        await appendFile(entry.targetPath, staged, "utf8");
      } else {
        await copyFile(entry.stagingPath, entry.targetPath);
      }
      const s = await stat(entry.targetPath);
      return { targetPath: entry.targetPath, bytes: s.size };
    } catch {
      return null;
    }
  }
}
