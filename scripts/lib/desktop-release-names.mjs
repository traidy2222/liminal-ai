/**
 * Desktop release artifact names — keep in sync with
 * vireondynamics-website/src/lib/liminal-desktop-downloads.ts
 */
export const GITHUB_REPO = "traidy2222/liminal-ai";
export const GITHUB_RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

/** @param {string} version */
export function desktopReleaseTag(version) {
  return `v${version}-desktop`;
}

/** @param {string} version */
export function desktopReleaseNotesUrl(version) {
  return `https://github.com/${GITHUB_REPO}/releases/tag/${desktopReleaseTag(version)}`;
}

/**
 * @param {"windows"|"macos"|"linux"} platform
 * @param {string} version
 */
export function desktopArtifactFileName(platform, version) {
  switch (platform) {
    case "windows":
      return `liminal-desktop-windows-x64-v${version}.zip`;
    case "macos":
      return `liminal-desktop-macos-arm64-v${version}.zip`;
    case "linux":
      return `liminal-desktop-linux-x64-v${version}.tar.gz`;
    default:
      throw new Error(`Unknown platform: ${platform}`);
  }
}

/** @param {string} version */
export function liminaldRuntimeFileName(version) {
  return `liminald-runtime-v${version}.zip`;
}

/** @param {string} version */
export function desktopManifestFileName(version) {
  return `liminal-desktop-manifest-v${version}.json`;
}

/**
 * @param {"windows"|"macos"|"linux"} platform
 * @param {string} version
 */
export function desktopDownloadUrl(platform, version) {
  const tag = desktopReleaseTag(version);
  const file = desktopArtifactFileName(platform, version);
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${file}`;
}

/** @param {string} version */
export function liminaldRuntimeDownloadUrl(version) {
  const tag = desktopReleaseTag(version);
  const file = liminaldRuntimeFileName(version);
  return `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${file}`;
}
