/**
 * Per-turn file revision tracking — keeps the model aligned with disk after edits.
 */

export function normalizeFilePathKey(path: string): string {
  return path.trim().replace(/\\/g, "/").toLowerCase();
}

/** Bump revision counter for a path; returns the new revision (1 = first edit this turn). */
export function bumpFileRevision(revisions: Map<string, number>, path: string): number {
  const key = normalizeFilePathKey(path);
  const next = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, next);
  return next;
}

export function getFileRevision(revisions: Map<string, number>, path: string): number {
  return revisions.get(normalizeFilePathKey(path)) ?? 0;
}

export function buildFileRevisionBatchNotice(
  paths: ReadonlyArray<{ path: string; rev: number }>
): string {
  if (paths.length === 0) return "";
  const lines = paths.map(({path,rev})=>`- ${path}: revision ${rev}`);
  return `[FILE REVISION] Successful edits this round:\n${lines.join("\n")}\nReuse the known post-edit content and returned SHA256. Reread only after an external change, version mismatch or failed replacement context.`;
}

export function isEditStaleFailure(error: string): boolean {
  return /version changed|file changed during editing|0 match|no changes|context mismatch|could not find the \d+ old lines|not found/i.test(
    error
  );
}

export function buildEditStaleRecoveryMessage(path: string, revision: number): string {
  const pathLabel = path.trim() || "(unknown path)";
  const revNote =
    revision > 0
      ? ` This file was already edited ${revision} time(s) earlier this turn — your search text is likely from a pre-edit snapshot.`
      : "";
  return (
    `[EDIT STALE] edit_file failed on \`${pathLabel}\` because the search/context did not match disk.${revNote} ` +
    `Recovery: grep_file(path, pattern) for the symbol or line you need, then edit_file with the verbatim match from that grep result. ` +
    `Do not retry the same search string without a fresh grep/read.`
  );
}
