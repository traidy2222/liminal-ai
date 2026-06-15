import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Swap extracted app release tree into the live install folder.
 * @param {{ exeDir: string; extractedRoot: string; platform: string }} opts
 */
export async function applyAppFolderSwap(opts) {
  const { exeDir, extractedRoot, platform } = opts;
  const backup = `${exeDir}.old.${Date.now()}`;

  let sourceRoot = extractedRoot;
  if (platform === "macos") {
    const appPath = fs
      .readdirSync(extractedRoot)
      .map((n) => path.join(extractedRoot, n))
      .find((p) => p.endsWith(".app") && fs.statSync(p).isDirectory());
    if (!appPath) throw new Error("macOS archive missing .app bundle");
    sourceRoot = appPath;
  } else if (platform === "linux") {
    const entries = fs.readdirSync(extractedRoot).map((n) => path.join(extractedRoot, n));
    sourceRoot = entries.find((p) => fs.existsSync(path.join(p, "liminal_desktop"))) ?? extractedRoot;
  }

  if (platform === "macos") {
    const destApp = path.join(path.dirname(exeDir), "liminal_desktop.app");
    if (fs.existsSync(destApp)) {
      fs.renameSync(destApp, `${destApp}.old.${Date.now()}`);
    }
    copyTree(sourceRoot, destApp);
    spawnSync("open", ["-n", destApp], { stdio: "ignore" });
    return;
  }

  if (fs.existsSync(exeDir)) {
    fs.renameSync(exeDir, backup);
  }
  fs.mkdirSync(exeDir, { recursive: true });
  copyTree(sourceRoot, exeDir);

  const exeName = platform === "windows" ? "liminal_desktop.exe" : "liminal_desktop";
  const exePath = path.join(exeDir, exeName);
  if (fs.existsSync(exePath) && platform !== "windows") {
    fs.chmodSync(exePath, 0o755);
  }
  if (platform === "windows" && fs.existsSync(exePath)) {
    spawnSync("cmd", ["/c", "start", "", exePath], { detached: true, stdio: "ignore" });
  } else if (fs.existsSync(exePath)) {
    spawnSync(exePath, [], { detached: true, stdio: "ignore" });
  }
}

/** @param {string} src @param {string} dest */
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}
