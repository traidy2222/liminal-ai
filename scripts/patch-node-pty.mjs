#!/usr/bin/env node
/** Compatibility fixes for node-pty 1.1.0, until upstream ships a stable fix.
 * https://github.com/microsoft/node-pty/issues/952 (kill/enumeration race)
 * https://github.com/microsoft/node-pty/issues/965 (natural-exit cleanup)
 * Apply to Windows JS on every platform: harness archives may be installed on Windows.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export function patchNodePty(packageRoot) {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  );
  if (pkg.version !== "1.1.0")
    throw Error(
      `Review node-pty compatibility patch before using ${pkg.version}`,
    );
  const agentPath = path.join(packageRoot, "lib/windowsPtyAgent.js");
  let agent = fs.readFileSync(agentPath, "utf8").replace(/\r\n/g, "\n");
  const helperPath = path.join(packageRoot, "lib/conpty_console_list_agent.js");
  let helper = fs.readFileSync(helperPath, "utf8").replace(/\r\n/g, "\n");
  if (!agent.includes("LIMINAL_PTY_CLEANUP_V1")) {
    const oldKill = `                this._getConsoleProcessList().then(function (consoleProcessList) {
                    consoleProcessList.forEach(function (pid) {`;
    const newKill = `                // LIMINAL_PTY_CLEANUP_V1: enumerate before tearing down the console.
                this._getConsoleProcessList().then(function (consoleProcessList) {
                    _this._ptyNative.kill(_this._pty, _this._useConptyDll);
                    _this._conoutSocketWorker.dispose();
                    consoleProcessList.forEach(function (pid) {`;
    const oldTeardown = `                });
                this._ptyNative.kill(this._pty, this._useConptyDll);
                this._conoutSocketWorker.dispose();`;
    const oldExit = `        this._outSocket.destroy();
    };`;
    if (
      !agent.includes(oldKill) ||
      !agent.includes(oldTeardown) ||
      !agent.includes(oldExit)
    )
      throw Error(
        "Unexpected node-pty Windows agent source; patch was not applied",
      );
    agent = agent
      .replace(oldKill, newKill)
      .replace(oldTeardown, "                });")
      .replace(
        oldExit,
        `        this._outSocket.destroy();
        this._inSocket.destroy();
        this._conoutSocketWorker.dispose();
    };`,
      );
  }
  if (!helper.includes("LIMINAL_PTY_ENUMERATION_V1")) {
    const before = "var consoleProcessList = getConsoleProcessList(shellPid);";
    if (!helper.includes(before))
      throw Error(
        "Unexpected node-pty console-list helper; patch was not applied",
      );
    helper = helper.replace(
      before,
      `// LIMINAL_PTY_ENUMERATION_V1: a naturally exited shell no longer has a console.
var consoleProcessList = [];
try { consoleProcessList = getConsoleProcessList(shellPid); } catch (_) { /* already exited */ }`,
    );
  }
  fs.writeFileSync(agentPath, agent);
  fs.writeFileSync(helperPath, helper);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  patchNodePty(
    path.resolve(process.argv[2] ?? path.join(root, "node_modules/node-pty")),
  );
  console.log("node-pty Windows cleanup compatibility patch ready");
}
