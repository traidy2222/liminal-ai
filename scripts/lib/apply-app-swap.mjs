import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";

/** Prepare beside the install, preserve configuration, then swap with rollback. */
export async function applyAppFolderSwap({
  exeDir,
  extractedRoot,
  platform,
  launch = launchApplication,
}) {
  let source = path.resolve(extractedRoot),
    target = path.resolve(exeDir);
  if (platform === "macos") {
    if (
      path.basename(target) !== "MacOS" ||
      path.basename(path.dirname(target)) !== "Contents"
    )
      throw Error("Invalid macOS install layout");
    target = path.dirname(path.dirname(target));
    source = fs
      .readdirSync(source)
      .map((n) => path.join(source, n))
      .find((n) => n.endsWith(".app") && fs.statSync(n).isDirectory());
    if (!source) throw Error("macOS archive missing .app bundle");
  } else if (
    platform === "linux" &&
    !fs.existsSync(path.join(source, "liminal_desktop"))
  ) {
    source = fs
      .readdirSync(source)
      .map((n) => path.join(source, n))
      .find(
        (n) =>
          fs.statSync(n).isDirectory() &&
          fs.existsSync(path.join(n, "liminal_desktop")),
      );
    if (!source) throw Error("Linux archive missing app");
  } else if (platform !== "windows" && platform !== "linux")
    throw Error("Unsupported update platform");
  if (
    target === path.parse(target).root ||
    target === source ||
    source.startsWith(target + path.sep)
  )
    throw Error("Unsafe update location");
  const runtimeRelative =
    platform === "macos" ? path.join("Contents", "MacOS") : "";
  const binary =
    platform === "windows" ? "liminal_desktop.exe" : "liminal_desktop";
  const binaryRelative = path.join(runtimeRelative, binary);
  const runtime = (p) => path.join(p, runtimeRelative, "liminald", "repo");
  const manifest = path.join(
    source,
    runtimeRelative,
    "liminald",
    "bundle.json",
  );
  if (
    !fs.statSync(path.join(source, binaryRelative)).isFile() ||
    !fs.existsSync(manifest)
  )
    throw Error("Incomplete app archive");
  JSON.parse(fs.readFileSync(manifest, "utf8"));
  if (!fs.existsSync(path.join(target, binaryRelative)))
    throw Error("Existing app missing; use the installer");
  const staging = target + ".new." + randomUUID(),
    backup = target + ".old." + randomUUID();
  let moved = false,
    installed = false;
  try {
    fs.cpSync(source, staging, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
    // Portable installs can use the bundled repo as their workspace. Preserve
    // local memory, sessions, workflow artifacts and preferences along with keys.
    // Keep extra workspace entries (e.g. generated HTML) absent from the release;
    // packaged runtime entries still come from the new bundle.
    const localNames = fs.existsSync(runtime(target))
      ? fs.readdirSync(runtime(target)).filter((name) =>
          name === ".env" || name.startsWith(".agent_") ||
          (name !== ".git" && !fs.existsSync(path.join(runtime(source), name))))
      : [];
    for (const name of localNames) {
      const from = path.join(runtime(target), name);
      if (fs.existsSync(from)) {
        const to = path.join(runtime(staging), name);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.cpSync(from, to, {
          recursive: true,
          preserveTimestamps: true,
          verbatimSymlinks: true,
        });
      }
    }
    if (platform !== "windows")
      fs.chmodSync(path.join(staging, binaryRelative), 0o755);
    fs.renameSync(target, backup);
    moved = true;
    fs.renameSync(staging, target);
    installed = true;
    await launch({
      target,
      exePath: path.join(target, binaryRelative),
      platform,
    });
    return { backup, target };
  } catch (error) {
    if (moved) {
      if (installed) fs.rmSync(target, { recursive: true, force: true });
      fs.renameSync(backup, target);
      // The parent app has exited; reopen the restored installation.
      try {
        await launch({
          target,
          exePath: path.join(target, binaryRelative),
          platform,
        });
      } catch {}
      error.updateRecoveryAttempted = true;
    }
    throw error;
  } finally {
    if (fs.existsSync(staging))
      fs.rmSync(staging, { recursive: true, force: true });
  }
}

export async function launchApplication({ target, exePath, platform }) {
  if (platform === "macos") {
    const result = spawnSync("open", ["-n", target], { stdio: "ignore" });
    if (result.error || result.status !== 0)
      throw Error("Could not reopen updated app");
    return;
  }
  await new Promise((resolve, reject) => {
    const child = spawn(exePath, [], {
      cwd: path.dirname(exePath),
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export async function relaunchInstalledApp(exeDir, platform) {
  const target =
    platform === "macos" ? path.dirname(path.dirname(exeDir)) : exeDir;
  const exePath = path.join(
    exeDir,
    platform === "windows" ? "liminal_desktop.exe" : "liminal_desktop",
  );
  await launchApplication({ target, exePath, platform });
}
