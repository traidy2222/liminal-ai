import assert from "node:assert/strict";
import test from "node:test";
import { watch } from "node:fs";
import { mkdtemp, writeFile, readFile, access, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { AgentEmitter, runWithWorkspaceRoot, type AgentHarness } from "@liminal/core";
import { PtyManager } from "./pty_manager.js";
import { createPtyShellPort } from "./pty_shell_port.js";
import { setPtyShellPort } from "../../tools/src/families/shell/pty_shell_port.js";
import { createRunShellTool } from "../../tools/src/families/shell/run_shell.js";
import { executeCodeTool } from "../../tools/src/families/code_intel/execute_code.js";

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

test("PTY launch errors name an invalid requested cwd and its recovery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-invalid-cwd-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-invalid-cwd-"));
    await rm(root, { recursive: true, force: true });
  });
  const file = path.join(root, "not-a-directory");
  await writeFile(file, "fixture");
  const manager = new PtyManager();
  t.after(() => manager.disposeAll());
  for (const cwd of [path.join(root, "missing-directory"), file]) {
    const input = { chatId: "owned-invalid-cwd", workspaceRoot: root, cwd, command: "echo unused", timeoutMs: 1000 };
    await assert.rejects(async () => manager.runOneshot(input), (err: Error) => {
      assert(err.message.includes(cwd));
      assert.match(err.message, /not an existing directory/);
      assert.match(err.message, /omit cwd.*workspace/);
      return true;
    });
    assert.throws(() => manager.open(input), /not an existing directory/);
  }
  assert.deepEqual(manager.list(), []);
});

test("pre-aborted foreground handlers do not start a runtime or shell", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "liminal-preaborted-"));
  t.after(async () => {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    assert(path.basename(root).startsWith("liminal-preaborted-"));
    await rm(root, { recursive: true, force: true });
  });
  const controller = new AbortController(); controller.abort();
  const marker = path.join(root, "launched.marker");
  const context = { signal: controller.signal };
  await runWithWorkspaceRoot(root, async () => {
    assert.equal((await executeCodeTool.handler({ code: "open('launched.marker', 'w').write('bad')" }, undefined, undefined, context)).ok, false);
    assert.equal((await createRunShellTool(new AgentEmitter()).handler({ command: "echo bad > launched.marker", cwd: root }, undefined, undefined, context)).ok, false);
    const manager = new PtyManager();
    await assert.rejects(manager.runOneshot({ chatId: "preaborted", workspaceRoot: root, command: "echo bad > launched.marker", timeoutMs: 1000, signal: controller.signal }), /cancel/i);
    assert.deepEqual(manager.list(), []);
  });
  await assert.rejects(access(marker));
});

for (const route of ["pty", "interactive", "pipe", "execute_code"] as const) {
  test(`aborting ${route} foreground work stops its owned Python process`, { skip: (route === "pty" || route === "interactive") && process.platform !== "win32" }, async (t) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "liminal-foreground-cancel-"));
    const pidFile = path.join(root, "job.pid");
    const lateFile = path.join(root, "late.marker");
    const python = `import os, time, pathlib\npathlib.Path(${JSON.stringify(pidFile)}).write_text(str(os.getpid()))\ntime.sleep(4)\npathlib.Path(${JSON.stringify(lateFile)}).write_text('must not happen after cancellation')\n`;
    const script = path.join(root, "job.py");
    await writeFile(script, python);
    const manager = new PtyManager();
    let pid: number | undefined;
    let watcher: ReturnType<typeof watch> | undefined;
    let readyTimer: ReturnType<typeof setTimeout> | undefined;
    const previous = process.env.AGENT_SHELL;
    if (process.platform === "win32") process.env.AGENT_SHELL = route === "interactive" ? "cmd" : "powershell";
    t.after(async () => {
      watcher?.close(); clearTimeout(readyTimer);
      manager.disposeAll(); setPtyShellPort(null);
      if (pid !== undefined && isAlive(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} }
      if (previous === undefined) delete process.env.AGENT_SHELL; else process.env.AGENT_SHELL = previous;
      assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
      assert(path.basename(root).startsWith("liminal-foreground-cancel-"));
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 20 });
    });

    const ready = new Promise<number>((resolve, reject) => {
      const check = async () => {
        try {
          const text = await readFile(pidFile, "utf8");
          if (/^\d+$/.test(text)) { watcher?.close(); clearTimeout(readyTimer); resolve(Number(text)); }
        } catch {}
      };
      watcher = watch(root, () => { void check(); });
      readyTimer = setTimeout(() => reject(new Error("Owned Python fixture did not become ready")), 8000);
      void check();
    });
    const controller = new AbortController();
    const harness = { taskId: `owned-${route}-cancel`, workspaceRoot: root, getRuntimePreferences: () => null } as unknown as AgentHarness;
    const usesPty = route === "pty" || route === "interactive";
    if (usesPty) {
      const port = createPtyShellPort(manager, async (opts) => {
        const opened = manager.open({ ...opts, workspaceRoot: root });
        return { sessionId: opened.sessionId, label: opened.label, cwd: opened.cwd };
      }, () => root);
      setPtyShellPort(port);
    } else setPtyShellPort(null);

    const tool = route === "execute_code" ? executeCodeTool : createRunShellTool(new AgentEmitter(), usesPty ? harness : undefined);
    const args = route === "execute_code" ? { code: python, timeout_ms: 10000 } : { command: `python "${script}"`, cwd: root, timeout_ms: 10000 };
    const pending = runWithWorkspaceRoot(root, () => tool.handler(args, undefined, undefined, { signal: controller.signal }));
    pid = await ready;
    const background = route === "interactive" ? manager.open({ chatId: harness.taskId, workspaceRoot: root, source: "agent", forceNew: true, label: "Dedicated background fixture" }) : undefined;
    const abortedAt = Date.now();
    controller.abort();
    const result = await pending;
    assert.equal(result.ok, false, "cancelled work must never report success");
    if (!result.ok) assert.match(result.error, /cancel|abort/i);
    assert(Date.now() - abortedAt < 2000, "cancellation must not wait for the original command timeout");
    for (let i = 0; i < 100 && isAlive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(isAlive(pid), false, "the owned Python child must stop, not only its result promise");
    await assert.rejects(access(lateFile));
    if (usesPty) assert.deepEqual(manager.list(harness.taskId).map((entry) => entry.sessionId), background ? [background.sessionId] : []);
    if (background) assert.equal(manager.isAlive(background.sessionId), true, "a dedicated background tab must survive foreground cancellation");
  });
}
