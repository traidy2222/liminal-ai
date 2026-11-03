import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { PtyManager } from "./pty_manager.js";
import { runShellTool } from "../../tools/src/families/shell/run_shell.js";
import { runBackgroundTool, readProcessOutputTool, killProcessTool } from "../../tools/src/families/shell/process_manager.js";

test("WindowsPS hashes files through PTY and pipe launches inherited from PowerShell Core", { skip: process.platform !== "win32" }, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-psmodule-path-"));
  const foreignHome = path.join(root, "foreign-core");
  const foreignModules = path.join(foreignHome, "Modules");
  const foreignUtility = path.join(foreignModules, "Microsoft.PowerShell.Utility");
  const customModules = path.join(root, "custom-modules");
  const customModule = path.join(customModules, "LiminalFixture");
  await mkdir(foreignUtility, { recursive: true });
  await mkdir(customModule, { recursive: true });
  // Identity marker only: this fixture executable is never launched.
  await writeFile(path.join(foreignHome, "pwsh.exe"), "fixture marker");
  await writeFile(path.join(foreignUtility, "Microsoft.PowerShell.Utility.psd1"), "@{ModuleVersion='99.0.0';PowerShellVersion='3.0';CompatiblePSEditions=@('Core');CmdletsToExport=@('Get-FileHash');FunctionsToExport=@();NestedModules=@('missing-core.dll')}");
  await writeFile(path.join(customModule, "LiminalFixture.psm1"), "function Get-LiminalFixtureMarker { 'CUSTOM_MODULE_PRESERVED' }; Export-ModuleMember -Function Get-LiminalFixtureMarker");
  const fixture = path.join(root, "fixture.bin");
  const bytes = Buffer.from([0xff, 0x00, 0x01, 0xc3, 0x28]);
  await writeFile(fixture, bytes);
  const expected = crypto.createHash("sha256").update(bytes).digest("hex").toUpperCase();
  const nativeModules = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "Modules");
  const inherited = [foreignModules, customModules, nativeModules].join(";");
  const oldPath = process.env.PSModulePath;
  const oldShell = process.env.AGENT_SHELL;
  const manager = new PtyManager();
  let backgroundPid: number | undefined;
  process.env.PSModulePath = inherited;
  process.env.AGENT_SHELL = "powershell";
  t.after(async () => {
    if (backgroundPid !== undefined) await killProcessTool.handler({ pid: backgroundPid });
    manager.disposeAll();
    if (oldPath === undefined) delete process.env.PSModulePath; else process.env.PSModulePath = oldPath;
    if (oldShell === undefined) delete process.env.AGENT_SHELL; else process.env.AGENT_SHELL = oldShell;
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-psmodule-path-"));
    await rm(root, { recursive: true, force: true });
  });

  const command = `$ErrorActionPreference='Stop'; $hash=Get-FileHash -LiteralPath '${fixture.replaceAll("'", "''")}' -Algorithm SHA256; Import-Module LiminalFixture -ErrorAction Stop; Write-Output ('HASH=' + $hash.Hash); Get-LiminalFixtureMarker`;
  // Establish the reported failure using an actual uncorrected WindowsPS child.
  await assert.rejects(promisify(execFile)("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    windowsHide: true, timeout: 15_000,
  }), /Get-FileHash|module/i);

  const pty = await manager.runOneshot({ chatId: "owned-module-regression", workspaceRoot: root, cwd: root, command, cols: 200, timeoutMs: 15_000 });
  assert.equal(pty.exitCode, 0, pty.output);
  assert(pty.output.includes(`HASH=${expected}`), pty.output);
  assert.match(pty.output, /CUSTOM_MODULE_PRESERVED/);

  // No harness/UI PTY is passed: this exercises run_shell's pipe fallback.
  const piped = await runShellTool.handler({ command, cwd: root, timeout_ms: 15_000 });
  assert(piped.ok, piped.ok ? undefined : piped.error);
  assert(piped.output.includes(`HASH=${expected}`), piped.output);
  assert.match(piped.output, /CUSTOM_MODULE_PRESERVED/);

  const background = await runBackgroundTool.handler({ command, cwd: root, startup_wait_ms: 100 });
  assert(background.ok, background.ok ? undefined : background.error);
  backgroundPid = Number(background.output.match(/PID:\s*(\d+)/)?.[1]);
  assert(Number.isFinite(backgroundPid));
  let backgroundOutput = "";
  for (let i = 0; i < 50; i++) {
    const read = await readProcessOutputTool.handler({ pid: backgroundPid, tail_chars: 2000 });
    assert(read.ok, read.ok ? undefined : read.error);
    backgroundOutput = read.output;
    if (/exited \(code [^0]/.test(backgroundOutput) ||
        (/exited \(code 0\)/.test(backgroundOutput) && backgroundOutput.includes("CUSTOM_MODULE_PRESERVED"))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.match(backgroundOutput, /exited \(code 0\)/);
  assert(backgroundOutput.includes(`HASH=${expected}`), backgroundOutput);
  assert.match(backgroundOutput, /CUSTOM_MODULE_PRESERVED/);
  assert.equal(process.env.PSModulePath, inherited, "only child environments may change");
});
