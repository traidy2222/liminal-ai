import { access, appendFile, mkdir, readFile, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { atomicWriteText } from "../../shared/atomic_file_write.js";
import { resolveWithinWorkspace } from "../../shared/file_path_guard.js";
import {
  formatIntegrityFooter,
  isLikelyTruncatedContent,
  verifyWrittenContent,
  type FileWriteIntegrityReport,
} from "./file_write_integrity.js";

export type FileWriteMode = "create" | "append" | "overwrite";

/** Existing files above these thresholds require confirm_overwrite for mode=overwrite. */
export const OVERWRITE_GUARD_MIN_LINES = 8;
export const OVERWRITE_GUARD_MIN_BYTES = 400;

export const TRUNCATED_WRITE_ERROR =
  "Refusing write: content looks truncated (unclosed string/brace). Partial bytes NOT written. " +
  "Re-issue from the cut point or use write_file with mode=append.";

export function rejectIfLikelyTruncated(content: string): string | null {
  return isLikelyTruncatedContent(content) ? TRUNCATED_WRITE_ERROR : null;
}

export type PrepareFileWriteResult =
  | { ok: true; resolvedPath: string }
  | { ok: false; error: string };

export async function checkOverwriteAllowed(
  resolvedPath: string,
  confirmOverwrite: boolean
): Promise<{ ok: true } | { ok: false; error: string }> {
  let existing: string;
  try {
    existing = await readFile(resolvedPath, "utf8");
  } catch {
    return { ok: true };
  }
  const lines = existing.split("\n").length;
  const substantial =
    existing.length > OVERWRITE_GUARD_MIN_BYTES || lines > OVERWRITE_GUARD_MIN_LINES;
  if (!substantial || confirmOverwrite) {
    return { ok: true };
  }
  return {
    ok: false,
    error:
      `Refusing whole-file overwrite of ${resolvedPath} (${lines} lines, ${existing.length} bytes).\n` +
      "Use edit_file with replacements or diff for targeted changes.\n" +
      "Workflow: grep_file or read_file → edit_file. " +
      "Only if you truly need a full replace after read_file, use write_file with mode=overwrite and confirm_overwrite: true.",
  };
}

export async function prepareFileWrite(
  pathArg: string,
  mode: FileWriteMode,
  opts?: { confirmOverwrite?: boolean }
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
          "Use edit_file for a targeted change, write_file mode=append to extend, " +
          "or mode=overwrite with confirm_overwrite: true only after read_file when a full replace is intentional.",
      };
    } catch {
      /* create */
    }
  }
  if (mode === "overwrite") {
    const guard = await checkOverwriteAllowed(
      safe.resolvedPath,
      opts?.confirmOverwrite === true
    );
    if (!guard.ok) return guard;
  }
  try {
    await mkdir(dirname(safe.resolvedPath), { recursive: true });
    return { ok: true, resolvedPath: safe.resolvedPath };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

export async function commitContent(
  resolvedPath: string,
  content: string,
  mode: FileWriteMode
): Promise<void> {
  if (mode === "append") {
    await appendFile(resolvedPath, content, "utf8");
  } else {
    await atomicWriteText(resolvedPath, content, mode === "create");
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
  mode: FileWriteMode,
  opts?: { confirmOverwrite?: boolean }
): Promise<{ content: string; expectedContent: string }> {
  if (resolve(stagingPath) === resolve(targetPath)) throw new Error("Staging and target must differ.");
  const staged = await readFile(stagingPath, "utf8");
  let expectedContent = staged;
  const truncErr = rejectIfLikelyTruncated(staged);
  if (truncErr) {
    throw new Error(truncErr);
  }
  const prep = await prepareFileWrite(targetPath, mode, opts);
  if (!prep.ok) throw new Error(prep.error);
  targetPath = prep.resolvedPath;
  if (mode === "create") {
    try {
      await access(targetPath);
      throw new Error(`File already exists: ${targetPath}`);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT") throw err;
    }
    await commitContent(targetPath, staged, "create");
  } else if (mode === "append") {
    let payload = staged;
    try {
      const prev = await readFile(targetPath, "utf8");
      if (prev.length > 0 && !prev.endsWith("\n") && !payload.startsWith("\n")) {
        payload = "\n" + payload;
      }
      expectedContent = prev + payload;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await commitContent(targetPath, payload, "append");
  } else {
    const guard = await checkOverwriteAllowed(targetPath, opts?.confirmOverwrite === true);
    if (!guard.ok) throw new Error(guard.error);
    await commitContent(targetPath, staged, "overwrite");
  }
  await unlink(stagingPath).catch(() => undefined);
  return { content: staged, expectedContent };
}
