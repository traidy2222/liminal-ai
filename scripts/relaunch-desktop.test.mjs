import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
test(
  "detached relaunch helper uses its own files and accepts a non-running parent PID",
  { skip: process.platform !== "win32" },
  (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "liminal-relaunch-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const helper = path.join(root, "outside helper"),
      install = path.join(root, "installed app");
    fs.mkdirSync(helper);
    fs.mkdirSync(install);
    fs.copyFileSync(
      "scripts/relaunch-desktop-windows.ps1",
      path.join(helper, "relaunch.ps1"),
    );
    fs.writeFileSync(
      path.join(helper, "apply-desktop-update.mjs"),
      `import fs from 'node:fs';import path from 'node:path';const args=process.argv.slice(2);fs.writeFileSync(path.join(args[args.indexOf('--exe-dir')+1],'probe.json'),JSON.stringify(args));`,
    );
    fs.writeFileSync(path.join(install, "pending_update.json"), "{}");
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(helper, "relaunch.ps1"),
        "-ParentPid",
        "2147483647",
        "-ExeDir",
        install,
        "-ArchivePath",
        path.join(root, "fixture.zip"),
      ],
      { cwd: helper, windowsHide: true, timeout: 15000, stdio: "pipe" },
    );
    const args = JSON.parse(
      fs.readFileSync(path.join(install, "probe.json"), "utf8"),
    );
    assert.equal(args[args.indexOf("--exe-dir") + 1], install);
    assert.equal(
      fs.existsSync(path.join(install, "pending_update.json")),
      false,
    );
  },
);
