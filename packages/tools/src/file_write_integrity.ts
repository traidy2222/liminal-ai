import { readFile } from "node:fs/promises";
import crypto from "node:crypto";

export const FILE_WRITE_INTEGRITY_HASH_MAX_BYTES = 2_000_000;

export type FileWriteIntegrityReport = {
  lines: number;
  bytes: number;
  sha256: string | null;
  integrity: "ok" | "mismatch" | "skipped_large";
  likely_truncated: boolean;
};

export function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

export function isLikelyTruncatedContent(content: string): boolean {
  const t = content.trimEnd();
  if (t.length === 0) return false;
  const last = t[t.length - 1]!;
  if (last === "\\") return true;
  if (/[`"'([{<]$/.test(t)) return true;
  if (t.endsWith("<!--")) return true;
  let sq = 0;
  let dq = 0;
  let bt = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (c === "'" && (i === 0 || t[i - 1] !== "\\")) sq ^= 1;
    if (c === '"' && (i === 0 || t[i - 1] !== "\\")) dq ^= 1;
    if (c === "`" && (i === 0 || t[i - 1] !== "\\")) bt ^= 1;
  }
  return sq === 1 || dq === 1 || bt === 1;
}

export async function verifyWrittenContent(
  resolvedPath: string,
  expectedContent: string
): Promise<FileWriteIntegrityReport> {
  const likely_truncated = isLikelyTruncatedContent(expectedContent);
  const expectedBytes = Buffer.byteLength(expectedContent, "utf8");
  let disk = "";
  try {
    disk = await readFile(resolvedPath, "utf8");
  } catch {
    return {
      lines: 0,
      bytes: 0,
      sha256: null,
      integrity: "mismatch",
      likely_truncated,
    };
  }
  const lines = disk.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(disk, "utf8");
  if (expectedBytes > FILE_WRITE_INTEGRITY_HASH_MAX_BYTES) {
    return {
      lines,
      bytes,
      sha256: null,
      integrity: disk === expectedContent ? "ok" : "mismatch",
      likely_truncated,
    };
  }
  const expectedHash = sha256Text(expectedContent);
  const diskHash = sha256Text(disk);
  return {
    lines,
    bytes,
    sha256: diskHash,
    integrity: expectedHash === diskHash ? "ok" : "mismatch",
    likely_truncated,
  };
}

export function formatIntegrityFooter(report: FileWriteIntegrityReport): string {
  const parts = [
    `integrity=${report.integrity}`,
    `lines=${report.lines}`,
    `bytes=${report.bytes}`,
  ];
  if (report.sha256) parts.push(`sha256=${report.sha256.slice(0, 16)}…`);
  if (report.likely_truncated) parts.push("likely_truncated=true");
  return parts.join(" ");
}
