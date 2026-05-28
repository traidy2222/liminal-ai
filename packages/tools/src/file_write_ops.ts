import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { resolveWithinWorkspace } from "./file_path_guard.js";
import {
  formatIntegrityFooter,
  isLikelyTruncatedContent,
  verifyWrittenContent,
  type FileWriteIntegrityReport,
} from "./file_write_integrity.js";

export type FileWriteMode = "create" | "append" | "overwrite";

export const TRUNCATED_WRITE_ERROR =
  "Refusing write: content looks truncated (unclosed string/brace). Partial bytes NOT written. " +
  "Re-issue from the cut point or use write_file with mode=append.";

const LARGE_WRITE_BYTES = 256 * 1024;

export function rejectIfLikelyTruncated(content: string): string | null {
  return isLikelyTruncatedContent(content) ? TRUNCATED_WRITE_ERROR : null;
}

export type PrepareFileWriteResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; error: string };

export async function prepareFileWrite(
  pathArg: string,
  mode: FileWriteMode
): Promise<PrepareFileWriteResult> {
  const safe = resolveWithinWorkspace(pathArg);
  if (!safe.ok || !safe.resolvedPath) {
    return { ok: false, error: safe.error ?? "invalid path" };
  }
  if (mode === "create") {
    try {
      await access(safe.resolvedPath);
      return {
        ok: false,
        error:
          `File already exists: ${safe.resolvedPath}\n` +
          "Use edit_file for a targeted change, or write_file with mode=overwrite / mode=append.",
      };
    } catch {
      /* create */
    }
  }
  try {
    await mkdir(dirname(safe.resolvedPath), { recursive: true });
    return { ok: true, resolvedPath: safe.resolvedPath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function writeLargeContent(resolvedPath: string, content: string, mode: FileWriteMode): Promise<void> {
  const stream = createWriteStream(resolvedPath, {
    encoding: "utf8",
    flags: mode === "append" ? "a" : "w",
  });
  await pipeline(Readable.from([content]), stream);
}

export async function commitContent(
  resolvedPath: string,
  content: string,
  mode: FileWriteMode
): Promise<void> {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > LARGE_WRITE_BYTES) {
    await writeLargeContent(resolvedPath, content, mode);
    return;
  }
  if (mode === "append") {
    await appendFile(resolvedPath, content, "utf8");
  } else {
    await writeFile(resolvedPath, content, mode === "overwrite" ? "utf8" : "utf8");
  }
}

export async function finishWithIntegrity(
  resolvedPath: string,
  expectedContent: string
): Promise<{ report: FileWriteIntegrityReport; footer: string }> {
  const report = await verifyWrittenContent(resolvedPath, expectedContent);
  return { report, footer: formatIntegrityFooter(report) };
}

export async function promoteStagingFile(
  stagingPath: string,
  targetPath: string,
  mode: FileWriteMode
): Promise<string> {
  const staged = await readFile(stagingPath, "utf8");
  const truncErr = rejectIfLikelyTruncated(staged);
  if (truncErr) {
    throw new Error(truncErr);
  }
  if (mode === "create") {
    try {
      await access(targetPath);
      throw new Error(`File already exists: ${targetPath}`);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") throw err;
    }
    await writeFile(targetPath, staged, "utf8");
  } else if (mode === "append") {
    let payload = staged;
    try {
      const prev = await readFile(targetPath, "utf8");
      if (prev.length > 0 && !prev.endsWith("\n") && !payload.startsWith("\n")) {
        payload = "\n" + payload;
      }
    } catch {
      /* target missing — append creates it */
    }
    await commitContent(targetPath, payload, "append");
  } else {
    await commitContent(targetPath, staged, "overwrite");
  }
  return staged;
}
