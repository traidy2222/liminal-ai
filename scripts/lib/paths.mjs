import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LIB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_FROM_LIB = path.resolve(LIB_DIR, "../..");

/** @returns {string} */
export function getDefaultInstallDir() {
  if (process.env.LIMINAL_INSTALL_DIR?.trim()) {
    return path.resolve(process.env.LIMINAL_INSTALL_DIR.trim());
  }
  if (process.env.LIMINAL_HOME?.trim()) {
    return path.join(path.resolve(process.env.LIMINAL_HOME.trim()), "liminal-ai");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "liminal", "liminal-ai");
  }
  return path.join(os.homedir(), ".liminal", "liminal-ai");
}

/** @returns {string} */
export function getDefaultBinDir() {
  if (process.env.LIMINAL_HOME?.trim()) {
    return path.join(path.resolve(process.env.LIMINAL_HOME.trim()), "bin");
  }
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "liminal", "bin");
  }
  return path.join(os.homedir(), ".liminal", "bin");
}

/**
 * @param {string} [startDir]
 * @returns {string}
 */
export function resolveRepoRoot(startDir = process.cwd()) {
  if (process.env.LIMINAL_INSTALL_DIR?.trim()) {
    return path.resolve(process.env.LIMINAL_INSTALL_DIR.trim());
  }

  if (isLiminalRoot(REPO_FROM_LIB)) {
    return REPO_FROM_LIB;
  }

  let dir = path.resolve(startDir);
  for (;;) {
    if (isLiminalRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }

  return REPO_FROM_LIB;
}

/** @param {string} dir */
function isLiminalRoot(dir) {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) {
    return false;
  }
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    return pkg.name === "liminal" && fs.existsSync(path.join(dir, "packages", "core"));
  } catch {
    return false;
  }
}

/** @param {string} repoRoot */
export function coreDistMain(repoRoot) {
  return path.join(repoRoot, "packages", "core", "dist", "index.js");
}

/** @param {string} repoRoot */
export function toolsDistDir(repoRoot) {
  return path.join(repoRoot, "packages", "tools", "dist");
}

/** @param {string} repoRoot */
export function webClientDistIndex(repoRoot) {
  return path.join(repoRoot, "packages", "web", "client", "dist", "index.html");
}

/** @param {string} repoRoot */
export function envPath(repoRoot) {
  return path.join(repoRoot, ".env");
}

/** @param {string} repoRoot */
export function envExamplePath(repoRoot) {
  return path.join(repoRoot, ".env.example");
}
