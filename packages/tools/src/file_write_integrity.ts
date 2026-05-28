import { readFile } from "node:fs/promises";
import crypto from "node:crypto";
import { isLikelyTruncatedFileContent } from "@liminal/core";
import {
  analyzeHtmlCoherence,
  formatHtmlCoherenceFooter,
  isLikelyHtmlFile,
  type HtmlCoherenceIssue,
} from "./html_write_coherence.js";

export const FILE_WRITE_INTEGRITY_HASH_MAX_BYTES = 2_000_000;

export type FileWriteIntegrityReport = {
  lines: number;
  bytes: number;
  sha256: string | null;
  integrity: "ok" | "mismatch" | "skipped_large";
  likely_truncated: boolean;
  html_coherence: "ok" | "warn";
  html_coherence_issues: HtmlCoherenceIssue[];
};

export function sha256Text(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/** @see isLikelyTruncatedFileContent in @liminal/core */
export const isLikelyTruncatedContent = isLikelyTruncatedFileContent;

function htmlCoherenceFields(
  resolvedPath: string,
  disk: string
): Pick<FileWriteIntegrityReport, "html_coherence" | "html_coherence_issues"> {
  if (!isLikelyHtmlFile(resolvedPath, disk)) {
    return { html_coherence: "ok", html_coherence_issues: [] };
  }
  const html_coherence_issues = analyzeHtmlCoherence(disk);
  return {
    html_coherence: html_coherence_issues.length > 0 ? "warn" : "ok",
    html_coherence_issues,
  };
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
      html_coherence: "ok",
      html_coherence_issues: [],
    };
  }
  const lines = disk.split(/\r?\n/).length;
  const bytes = Buffer.byteLength(disk, "utf8");
  const htmlFields = htmlCoherenceFields(resolvedPath, disk);
  if (expectedBytes > FILE_WRITE_INTEGRITY_HASH_MAX_BYTES) {
    return {
      lines,
      bytes,
      sha256: null,
      integrity: disk === expectedContent ? "ok" : "mismatch",
      likely_truncated,
      ...htmlFields,
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
    ...htmlFields,
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
  if (report.html_coherence === "warn") {
    parts.push(formatHtmlCoherenceFooter(report.html_coherence_issues));
  }
  return parts.join(" ");
}
