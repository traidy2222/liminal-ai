import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import {
  GITHUB_RELEASES_URL,
  desktopArtifactFileName,
  desktopDownloadUrl,
  desktopManifestFileName,
  desktopReleaseTag,
  liminaldRuntimeDownloadUrl,
  liminaldRuntimeFileName,
} from "./desktop-release-names.mjs";
/** @param {string} content */
function parseSha256Sidecar(content) {
  const line = content.trim().split(/\r?\n/)[0] ?? "";
  const match = line.match(/^([a-f0-9]{64})\b/i);
  return match ? match[1].toLowerCase() : null;
}

/** @param {string} version */
export function normalizeVersion(version) {
  return String(version).trim().replace(/^v/i, "");
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} negative if a < b
 */
export function compareSemver(a, b) {
  const pa = normalizeVersion(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = normalizeVersion(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length, 3);
  for (let i = 0; i < len; i++) {
    const da = pa[i] ?? 0;
    const db = pb[i] ?? 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/** @param {string} a @param {string} b */
export function isVersionLess(a, b) {
  return compareSemver(a, b) < 0;
}

/**
 * @param {{ channel?: "stable"|"beta"; token?: string }} [opts]
 */
export async function resolveLatestDesktopRelease(opts = {}) {
  const channel = opts.channel ?? "stable";
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "liminal-updater",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (opts.token?.trim()) {
    headers.Authorization = `Bearer ${opts.token.trim()}`;
  }

  const res = await fetch(`${GITHUB_RELEASES_URL}?per_page=100`, { headers });
  if (!res.ok) {
    throw new Error(`GitHub releases API failed: ${res.status} ${res.statusText}`);
  }
  /** @type {Array<{ tag_name: string; prerelease: boolean; published_at: string; assets: Array<{ name: string; browser_download_url: string; size: number }> }>} */
  const releases = await res.json();

  const desktopReleases = releases
    .filter((r) => /^v.+-desktop$/i.test(r.tag_name))
    .filter((r) => {
      if (channel === "beta") return true;
      // During public beta, desktop tags are often prerelease — still offer updates on stable.
      return true;
    })
    .map((r) => {
      const match = r.tag_name.match(/^v(.+)-desktop$/i);
      return {
        version: match?.[1] ?? "",
        tag: r.tag_name,
        publishedAt: r.published_at,
        prerelease: r.prerelease,
        assets: r.assets ?? [],
      };
    })
    .filter((r) => r.version);

  desktopReleases.sort((a, b) => compareSemver(b.version, a.version));
  const latest = desktopReleases[0];
  if (!latest) {
    throw new Error("No desktop releases found on GitHub");
  }
  return latest;
}

/**
 * @param {{ appVersion: string; harnessVersion: string; latestVersion: string }} input
 */
export function compareVersions(input) {
  const latest = normalizeVersion(input.latestVersion);
  const app = normalizeVersion(input.appVersion);
  const harness = normalizeVersion(input.harnessVersion || app);
  return {
    latestVersion: latest,
    appUpdate: isVersionLess(app, latest),
    harnessUpdate: isVersionLess(harness, latest),
  };
}

/**
 * @param {string} exeDir
 */
export function readLocalHarnessVersion(exeDir) {
  const manifestPath = path.join(exeDir, "liminald", "bundle.json");
  if (!fs.existsSync(manifestPath)) return null;
  try {
    const json = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    return normalizeVersion(json.liminalVersion ?? "");
  } catch {
    return null;
  }
}

/**
 * @param {string} exeDir
 */
export function isPortableDesktopInstall(exeDir) {
  return fs.existsSync(path.join(exeDir, "liminald", "bundle.json"));
}

/**
 * @param {string} url
 * @param {string} dest
 * @param {{ expectedSha256?: string | null; onProgress?: (loaded: number, total: number | null) => void }} [opts]
 */
export async function downloadAsset(url, dest, opts = {}) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Download failed (${res.status}): ${url}`);
  }
  const total = Number(res.headers.get("content-length")) || null;
  let loaded = 0;
  const hash = createHash("sha256");
  const file = createWriteStream(dest);

  if (!res.body) {
    throw new Error(`Empty response body: ${url}`);
  }

  const reader = Readable.fromWeb(res.body);
  reader.on("data", (chunk) => {
    loaded += chunk.length;
    hash.update(chunk);
    opts.onProgress?.(loaded, total);
  });
  await pipeline(reader, file);

  const digest = hash.digest("hex");
  if (opts.expectedSha256 && digest !== opts.expectedSha256.toLowerCase()) {
    fs.unlinkSync(dest);
    throw new Error(`SHA256 mismatch for ${path.basename(dest)}`);
  }
  return digest;
}

/**
 * @param {string} archivePath
 * @param {string} destDir
 */
export async function extractLiminaldFromArchive(archivePath, destDir) {
  fs.mkdirSync(destDir, { recursive: true });
  const base = path.basename(archivePath).toLowerCase();

  if (base.endsWith(".zip")) {
    await extractZipSubset(archivePath, destDir, (entry) =>
      entry.startsWith("liminald/") || entry === "liminald",
    );
    const liminaldPath = path.join(destDir, "liminald");
    if (!fs.existsSync(liminaldPath)) {
      throw new Error("Archive does not contain liminald/");
    }
    return liminaldPath;
  }

  throw new Error(`Unsupported archive for harness extract: ${archivePath}`);
}

/**
 * Minimal zip extract for liminald/ prefix using PowerShell on Windows or unzip elsewhere.
 * @param {string} zipPath
 * @param {string} destDir
 * @param {(name: string) => boolean} include
 */
async function extractZipSubset(zipPath, destDir, include) {
  if (process.platform === "win32") {
    const ps = `
$zip = '${zipPath.replace(/'/g, "''")}'
$dest = '${destDir.replace(/'/g, "''")}'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
try {
  foreach ($entry in $archive.Entries) {
    $name = $entry.FullName.Replace('\\\\','/')
    $ok = $false
    if ($name -like 'liminald/*' -or $name -eq 'liminald') { $ok = $true }
    if (-not $ok) { continue }
    $out = Join-Path $dest $entry.FullName
    $dir = Split-Path $out -Parent
    if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
    if ($entry.Name) { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $out, $true) }
  }
} finally { $archive.Dispose() }
`;
    const r = spawnSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" });
    if (r.status !== 0) {
      throw new Error(r.stderr || "PowerShell zip extract failed");
    }
    return;
  }

  const r = spawnSync("unzip", ["-q", zipPath, "liminald/*", "-d", destDir], {
    encoding: "utf8",
  });
  if (r.status !== 0) {
    throw new Error(r.stderr || "unzip failed");
  }
}

/**
 * @param {string} exeDir
 * @param {string} stagingLiminaldPath
 */
export function applyHarnessSwap(exeDir, stagingLiminaldPath) {
  const target = path.join(exeDir, "liminald");
  const backup = `${target}.bak.${Date.now()}`;
  const envBackup = path.join(backup, "repo", ".env");

  if (fs.existsSync(target)) {
    fs.renameSync(target, backup);
  }

  try {
    fs.renameSync(stagingLiminaldPath, target);
  } catch (err) {
    if (fs.existsSync(backup) && !fs.existsSync(target)) {
      fs.renameSync(backup, target);
    }
    throw err;
  }

  if (fs.existsSync(envBackup)) {
    const destEnv = path.join(target, "repo", ".env");
    fs.mkdirSync(path.dirname(destEnv), { recursive: true });
    fs.copyFileSync(envBackup, destEnv);
  }

  return { backup };
}

/**
 * @param {string} exeDir
 * @param {string} archivePath
 * @param {string} platform
 */
export async function extractAppArchive(exeDir, archivePath, platform) {
  const staging = path.join(os.tmpdir(), `liminal-app-update-${Date.now()}`);
  fs.mkdirSync(staging, { recursive: true });

  if (platform === "linux" && archivePath.endsWith(".tar.gz")) {
    const r = spawnSync("tar", ["-xzf", archivePath, "-C", staging], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr || "tar extract failed");
    return staging;
  }

  if (archivePath.endsWith(".zip")) {
    if (process.platform === "win32") {
      const r = spawnSync(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -Path '${archivePath.replace(/'/g, "''")}' -DestinationPath '${staging.replace(/'/g, "''")}' -Force`,
        ],
        { encoding: "utf8" },
      );
      if (r.status !== 0) throw new Error(r.stderr || "Expand-Archive failed");
    } else {
      const r = spawnSync("unzip", ["-q", archivePath, "-d", staging], { encoding: "utf8" });
      if (r.status !== 0) throw new Error(r.stderr || "unzip failed");
    }
    return staging;
  }

  throw new Error(`Unsupported app archive: ${archivePath}`);
}

/**
 * @param {"windows"|"macos"|"linux"} platform
 * @param {string} version
 */
export function resolvePlatformAsset(platform, version) {
  const file = desktopArtifactFileName(platform, version);
  return {
    file,
    url: desktopDownloadUrl(platform, version),
    sha256Url: `${desktopDownloadUrl(platform, version)}.sha256`,
  };
}

/** @param {string} version */
export function resolveLiminaldAsset(version) {
  const file = liminaldRuntimeFileName(version);
  return {
    file,
    url: liminaldRuntimeDownloadUrl(version),
    sha256Url: `${liminaldRuntimeDownloadUrl(version)}.sha256`,
  };
}

/** @param {string} sha256Url */
export async function fetchSha256FromSidecar(sha256Url) {
  const res = await fetch(sha256Url);
  if (!res.ok) return null;
  return parseSha256Sidecar(await res.text());
}

/**
 * @param {{ exeDir: string; appVersion: string; channel?: "stable"|"beta" }} opts
 */
export async function checkDesktopUpdate(opts) {
  const latest = await resolveLatestDesktopRelease({ channel: opts.channel });
  const harnessVersion = readLocalHarnessVersion(opts.exeDir) ?? opts.appVersion;
  const cmp = compareVersions({
    appVersion: opts.appVersion,
    harnessVersion,
    latestVersion: latest.version,
  });

  const manifestAsset = latest.assets.find((a) =>
    a.name === desktopManifestFileName(latest.version),
  );

  return {
    ...cmp,
    tag: latest.tag,
    publishedAt: latest.publishedAt,
    notesUrl: `https://github.com/traidy2222/liminal-ai/releases/tag/${latest.tag}`,
    manifestUrl: manifestAsset?.browser_download_url ?? null,
    liminaldAsset: resolveLiminaldAsset(latest.version),
    platformAssets: {
      windows: resolvePlatformAsset("windows", latest.version),
      macos: resolvePlatformAsset("macos", latest.version),
      linux: resolvePlatformAsset("linux", latest.version),
    },
  };
}

/** @param {number} ms */
function sleepMs(ms) {
  if (process.platform === "win32") {
    spawnSync("powershell", ["-NoProfile", "-Command", `Start-Sleep -Milliseconds ${ms}`], {
      stdio: "ignore",
    });
  } else {
    spawnSync("sleep", [String(Math.max(0.05, ms / 1000))], { stdio: "ignore" });
  }
}

/** @param {number} pid */
export function waitForProcessExit(pid, timeoutMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    sleepMs(200);
  }
  return false;
}

/**
 * Spawn detached relaunch helper for app updates.
 * @param {{ exeDir: string; archivePath: string; parentPid: number; platform: string }} opts
 */
export function spawnAppRelauncher(opts) {
  const updaterDir = path.join(opts.exeDir, "liminald", "updater");
  const pendingPath = path.join(opts.exeDir, "pending_update.json");
  fs.writeFileSync(
    pendingPath,
    JSON.stringify(
      {
        archivePath: opts.archivePath,
        platform: opts.platform,
        version: null,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );

  if (process.platform === "win32") {
    const script = path.join(updaterDir, "relaunch-desktop-windows.ps1");
    const child = spawn(
      "powershell",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "-ParentPid",
        String(opts.parentPid),
        "-ExeDir",
        opts.exeDir,
        "-ArchivePath",
        opts.archivePath,
      ],
      { detached: true, stdio: "ignore" },
    );
    child.unref();
    return;
  }

  const script = path.join(updaterDir, "relaunch-desktop.sh");
  const child = spawn(
    "bash",
    [script, String(opts.parentPid), opts.exeDir, opts.archivePath],
    { detached: true, stdio: "ignore" },
  );
  child.unref();
}
