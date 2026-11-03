import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prepareShellChildEnvironment } from "./shell_child_environment.js";

test("WindowsPS removes only identifiable local Core system module roots", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-child-shell-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-child-shell-"));
    await rm(root, { recursive: true, force: true });
  });
  const coreHome = path.join(root, "portable-core");
  const coreModules = path.join(coreHome, "Modules");
  await mkdir(coreModules, { recursive: true });
  await writeFile(path.join(coreHome, "pwsh.exe"), "identity marker, never executed");
  const custom = path.join(root, "custom", "Modules");
  const native = path.join(root, "WindowsPowerShell", "Modules");
  const remote = "\\\\server\\custom\\Modules";
  const before = { PSMODULEPATH: [custom, coreModules, native, remote].join(";"), CUSTOM_FLAG: "preserved" };
  const child = prepareShellChildEnvironment("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", before, "win32");
  assert.equal(child.PSMODULEPATH, [custom, native, remote].join(";"));
  assert.equal(child.CUSTOM_FLAG, "preserved");
  assert.equal(before.PSMODULEPATH, [custom, coreModules, native, remote].join(";"));
  const onlyCore = prepareShellChildEnvironment("powershell.exe", { PSModulePath: coreModules }, "win32");
  assert.equal("PSModulePath" in onlyCore, false);

  for (const executable of ["pwsh.exe", "cmd.exe", "bash.exe"]) {
    assert.deepEqual(prepareShellChildEnvironment(executable, before, "win32"), before);
  }
  assert.deepEqual(prepareShellChildEnvironment("powershell.exe", before, "linux"), before);
});

test("shell preparation returns an independent environment without inventing module settings", () => {
  const before = { CUSTOM_FLAG: "preserved" };
  const child = prepareShellChildEnvironment("powershell.exe", before, "win32");
  assert.deepEqual(child, before);
  child.CUSTOM_FLAG = "child-only";
  assert.equal(before.CUSTOM_FLAG, "preserved");
});
