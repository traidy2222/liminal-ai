#!/usr/bin/env node
/**
 * Build liminal-desktop-manifest-v{version}.json from dist/ artifacts + .sha256 files.
 * Usage: node scripts/generate-desktop-manifest.mjs --version 0.1.0 [--dist dist]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  desktopArtifactFileName,
  desktopManifestFileName,
  desktopReleaseNotesUrl,
  desktopReleaseTag,
  liminaldRuntimeFileName,
} from "./lib/desktop-release-names.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

/** @param {string} content */
export function parseSha256Sidecar(content) {
  const line = content.trim().split(/\r?\n/)[0] ?? "";
  const match = line.match(/^([a-f0-9]{64})\b/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * @param {string} distDir
 * @param {string} fileName
 */
function readAssetMeta(distDir, fileName) {
  const filePath = path.join(distDir, fileName);
  if (!fs.existsSync(filePath)) {
    return null;
  }
  const hashPath = `${filePath}.sha256`;
  let sha256 = null;
  if (fs.existsSync(hashPath)) {
    sha256 = parseSha256Sidecar(fs.readFileSync(hashPath, "utf8"));
  }
  return {
    file: fileName,
    sha256,
    size: fs.statSync(filePath).size,
  };
}

/**
 * @param {{ version: string; distDir?: string; publishedAt?: string }} opts
 */
export function buildDesktopManifest(opts) {
  const version = opts.version;
  const distDir = opts.distDir ?? path.join(REPO_ROOT, "dist");
  const publishedAt = opts.publishedAt ?? new Date().toISOString();

  /** @type {Record<string, { file: string; sha256: string | null; size: number } | null>} */
  const assets = {
    windows: readAssetMeta(distDir, desktopArtifactFileName("windows", version)),
    macos: readAssetMeta(distDir, desktopArtifactFileName("macos", version)),
    linux: readAssetMeta(distDir, desktopArtifactFileName("linux", version)),
    liminald: readAssetMeta(distDir, liminaldRuntimeFileName(version)),
  };

  return {
    version,
    tag: desktopReleaseTag(version),
    publishedAt,
    notesUrl: desktopReleaseNotesUrl(version),
    assets,
  };
}

function parseArgs(argv) {
  let version = "";
  let distDir = path.join(REPO_ROOT, "dist");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--version" && argv[i + 1]) {
      version = argv[++i];
    } else if (argv[i] === "--dist" && argv[i + 1]) {
      distDir = path.resolve(argv[++i]);
    }
  }
  if (!version) {
    const releasesPath = path.join(REPO_ROOT, "changelog", "releases.json");
    version = JSON.parse(fs.readFileSync(releasesPath, "utf8")).currentVersion;
  }
  return { version, distDir };
}

function main() {
  const { version, distDir } = parseArgs(process.argv.slice(2));
  const manifest = buildDesktopManifest({ version, distDir });
  const outName = desktopManifestFileName(version);
  const outPath = path.join(distDir, outName);
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${outPath}`);
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, "/")}` ||
    process.argv[1]?.endsWith("generate-desktop-manifest.mjs")) {
  main();
}
