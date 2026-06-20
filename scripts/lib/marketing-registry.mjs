/**
 * Build marketing capture registry entries from manifest JSON + prompt catalog.
 * Used by publish flow and website generate-marketing-captures.mjs (via liminal root).
 */
import fs from "node:fs";
import path from "node:path";
import { LEGACY_PROMPT_IDS, MARKETING_PROMPT_BASES } from "./marketing-prompts.mjs";

const CAPTURE_WIDTH = 1280;
const CAPTURE_HEIGHT = 800;

/** @typedef {"desktop" | "live"} MarketingChannel */

/**
 * @param {string} id
 * @returns {string | null}
 */
function promptKeyFromId(id) {
  const legacy = LEGACY_PROMPT_IDS[id];
  const resolved = legacy ?? id;
  const m = resolved.match(/^(?:desktop|live)-(.+)$/);
  return m?.[1] ?? null;
}

/**
 * @param {string} key
 */
function metaForKey(key) {
  return MARKETING_PROMPT_BASES.find((p) => p.key === key) ?? null;
}

/**
 * @param {number | undefined} ms
 */
export function formatDurationLabel(ms) {
  if (!ms || ms <= 0) return "~1 min";
  const sec = Math.round(ms / 1000);
  if (sec < 75) return `~${sec}s`;
  const min = sec / 60;
  if (min < 1.5) return "~1 min";
  return `~${min.toFixed(1).replace(/\.0$/, "")} min`;
}

/**
 * @param {object} row — manifest result row
 * @param {MarketingChannel} channel
 */
export function rowToCaptureEntry(row, channel) {
  if (row.error) return null;

  const key = promptKeyFromId(row.id);
  const meta = key ? metaForKey(key) : null;

  const tools = Array.isArray(row.tools) && row.tools.length
    ? row.tools.filter(Boolean)
    : (meta?.expectTools ?? []);
  if (!tools.length) return null;

  const title = row.title ?? meta?.title ?? row.id;
  const subtitle = row.subtitle ?? meta?.subtitle ?? "";
  const prompt = row.prompt ?? meta?.prompt ?? "";

  const base = `/marketing/${channel}/${row.id}`;

  return {
    id: row.id,
    channel,
    title,
    subtitle,
    prompt: prompt.trim(),
    tools,
    durationLabel: formatDurationLabel(row.durationMs),
    width: CAPTURE_WIDTH,
    height: CAPTURE_HEIGHT,
    videoSrc: `${base}.mp4`,
    posterSrc: `${base}-poster.webp`,
    gifSrc: `${base}.gif`,
    pngSrc: `${base}.png`,
  };
}

/**
 * @param {string} manifestPath
 * @param {MarketingChannel} channel
 */
export function loadCapturesFromManifest(manifestPath, channel) {
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const results = Array.isArray(manifest.results) ? manifest.results : [];
  return results
    .map((row) => rowToCaptureEntry(row, channel))
    .filter(Boolean);
}

/**
 * @param {string} marketingDir
 * @param {MarketingChannel} channel
 */
function discoverIdsOnDisk(marketingDir, channel) {
  if (!fs.existsSync(marketingDir)) return [];
  const prefix = `${channel}-`;
  return [
    ...new Set(
      fs
        .readdirSync(marketingDir)
        .filter((f) => f.startsWith(prefix) && f.endsWith(".mp4"))
        .map((f) => f.replace(/\.mp4$/, ""))
    ),
  ];
}

/**
 * @param {string} marketingDir — assets/marketing
 */
export function loadAllCaptures(marketingDir) {
  const desktopManifest = loadCapturesFromManifest(
    path.join(marketingDir, "desktop-manifest.json"),
    "desktop"
  );
  const liveManifest = loadCapturesFromManifest(
    path.join(marketingDir, "live-manifest.json"),
    "live"
  );

  const desktop = mergeDiscoveredCaptures(desktopManifest, marketingDir, "desktop");
  const live = mergeDiscoveredCaptures(liveManifest, marketingDir, "live");

  return { desktop, live, all: [...desktop, ...live] };
}

/**
 * @param {ReturnType<typeof rowToCaptureEntry>[]} fromManifest
 * @param {string} marketingDir
 * @param {MarketingChannel} channel
 */
function mergeDiscoveredCaptures(fromManifest, marketingDir, channel) {
  const byId = new Map(fromManifest.map((c) => [c.id, c]));
  for (const id of discoverIdsOnDisk(marketingDir, channel)) {
    if (byId.has(id)) continue;
    const synthetic = rowToCaptureEntry({ id, tools: [], source: channel }, channel);
    if (synthetic) byId.set(id, synthetic);
  }
  return [...byId.values()];
}

/**
 * Collect asset basenames to sync for a manifest.
 * @param {string} manifestPath
 */
export function assetIdsFromManifest(manifestPath) {
  if (!fs.existsSync(manifestPath)) return [];
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const results = Array.isArray(manifest.results) ? manifest.results : [];
  return results
    .filter((r) => !r.error && Array.isArray(r.tools) && r.tools.length > 0)
    .map((r) => r.id);
}
