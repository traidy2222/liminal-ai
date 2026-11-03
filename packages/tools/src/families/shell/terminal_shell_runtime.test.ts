import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { AgentHarness } from "@liminal/core";
import type { PtyManagerPort } from "./pty_shell_port.js";
import { setPtyShellPort } from "./pty_shell_port.js";
import { getAgentShellSession } from "./agent_shell_session.js";
import {
  resetTerminalShellRuntimeForTests,
  runShellInTerminal,
  waitForShellReady,
  wrapPlainCommand,
  wrapPlainCommandWithExit,
  wrapBackgroundCommand,
} from "./terminal_shell_runtime.js";

beforeEach(() => {
  process.env.AGENT_SHELL_PROMPT_STABLE_MS = "20";
  resetTerminalShellRuntimeForTests();
  setPtyShellPort(null);
});

test("wrapPlainCommand passes command through without exit markers", () => {
  const cmd = wrapPlainCommand("whoami");
  assert.ok(cmd.includes("whoami"));
  assert.ok(!cmd.includes("__LIMINAL_EXIT"));
});

test("wrapPlainCommandWithExit no longer appends an exit suffix (OSC 133 markers carry it)", () => {
  const cmd = wrapPlainCommandWithExit("whoami");
  assert.ok(cmd.includes("whoami"));
  assert.ok(!cmd.includes("__LIMINAL_EXIT"));
  assert.ok(!cmd.includes("$LASTEXITCODE"));
  assert.ok(!cmd.includes("%ERRORLEVEL%"));
});

test("wrapPlainCommand with cwd", () => {
  const cmd = wrapPlainCommand("npm test", "/tmp/proj");
  assert.ok(cmd.includes("npm test"));
  if (process.platform === "win32") {
    const runtime = process.env["AGENT_SHELL"]?.trim().toLowerCase();
    if (runtime === "cmd") {
      assert.ok(cmd.includes("cd /d"));
    } else {
      assert.ok(cmd.includes("Set-Location"));
    }
  } else {
    assert.ok(cmd.includes("cd "));
  }
});

test("wrapBackgroundCommand does not add exit markers", () => {
  const cmd = wrapBackgroundCommand("npm run dev");
  assert.ok(!cmd.includes("__LIMINAL_EXIT"));
  assert.ok(cmd.includes("npm run dev"));
});

test("waitForShellReady resolves when prompt is visible", async () => {
  const prompt =
    process.platform === "win32" ? "PS C:\\repo> " : "user@host:~$ ";
  const port: PtyManagerPort = {
    ensure: async () => ({ sessionId: "s1", label: "Agent shell", cwd: "/repo" }),
    write: () => true,
    readTail: () => prompt,
    onData: () => () => undefined,
    isAlive: () => true,
    close: () => true,
    list: () => [],
    runOneshot: async () => ({ exitCode: 0, output: "", sessionId: "s1" }),
  };
  await waitForShellReady(port, "s1", 1000);
});

test("cancelled queued or pre-aborted PowerShell jobs never spawn", { skip: process.platform !== "win32" }, async () => {
  let start!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { start = resolve; });
  let calls = 0;
  const port: PtyManagerPort = {
    ensure: async () => null, write: () => false, readTail: () => "", onData: () => () => undefined,
    isAlive: () => false, close: () => true, list: () => [],
    runOneshot: async () => {
      calls++; start(); await new Promise<void>((resolve) => { release = resolve; });
      return { exitCode: 0, output: "first complete", sessionId: "owned-first" };
    },
  };
  setPtyShellPort(port);
  try {
    const harness = { taskId: "queued-powershell-cancel" } as AgentHarness;
    const input = { harness, command: "owned-first", timeoutMs: 5000, cappedNote: "" };
    const first = runShellInTerminal(input);
    await started;
    const controller = new AbortController();
    const queued = runShellInTerminal({ ...input, command: "never-run", signal: controller.signal });
    controller.abort();
    assert.equal((await queued).ok, false);
    release(); assert.equal((await first).ok, true);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await runShellInTerminal({ ...input, signal: controller.signal })).ok, false);
    assert.equal(calls, 1);
  } finally { setPtyShellPort(null); }
});

test("runShellInTerminal serializes parallel calls on one chat", async () => {
  const prompt = process.platform === "win32" ? "PS C:\\repo> " : "user@host:~$ ";
  let backlog = prompt;
  const writes: string[] = [];
  let foregroundActive = 0, maxForegroundActive = 0;

  const port: PtyManagerPort = {
    ensure: async () => ({ sessionId: "s1", label: "Agent shell", cwd: "/repo" }),
    write: (_sessionId, data) => {
      writes.push(data);
      setTimeout(() => {
        if (data.includes("$LASTEXITCODE") || data.includes("%ERRORLEVEL%")) {
          backlog += `\n0\n${prompt}`;
        } else {
          backlog += `\nok\n${prompt}`;
        }
        for (const listener of dataListeners) listener(backlog);
      }, 25);
      return true;
    },
    readTail: () => backlog,
    onData: (_sessionId, listener) => {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    isAlive: () => true,
    close: () => true,
    list: () => [],
    runOneshot: async opts => {
      writes.push(opts.command);
      maxForegroundActive = Math.max(maxForegroundActive, ++foregroundActive);
      await new Promise(resolve => setTimeout(resolve, 25));
      foregroundActive--;
      return { exitCode: 0, output: "ok", sessionId: "s1" };
    },
  };
  const dataListeners = new Set<(chunk: string) => void>();
  setPtyShellPort(port);

  const harness = { taskId: "chat-serial" } as AgentHarness;
  const mk = (command: string) =>
    runShellInTerminal({
      harness,
      command,
      timeoutMs: 5000,
      cappedNote: "",
    });

  await Promise.all([mk("echo one"), mk("echo two"), mk("echo three")]);

  const cmdWrites = writes.filter((w) => /echo (one|two|three)/.test(w));
  assert.equal(cmdWrites.length, 3);
  assert.ok(cmdWrites[0]!.includes("echo one"));
  assert.ok(cmdWrites[1]!.includes("echo two"));
  assert.ok(cmdWrites[2]!.includes("echo three"));
  assert.ok(maxForegroundActive <= 1);

  setPtyShellPort(null);
});

test("interactive agent session waits for delayed shell boot before writing", async () => {
  const prompt = process.platform === "win32" ? "PS C:\\repo> " : "user@host:~$ ";
  let backlog = "";
  const writes: string[] = [];
  const dataListeners = new Set<(chunk: string) => void>();

  const port: PtyManagerPort = {
    ensure: async () => ({ sessionId: "s-boot", label: "Agent shell", cwd: "/repo" }),
    write: (_sessionId, data) => {
      writes.push(data);
      setTimeout(() => {
        backlog += `\nhi\n0\n${prompt}`;
        for (const listener of dataListeners) listener(backlog);
      }, 20);
      return true;
    },
    readTail: () => backlog,
    onData: (_sessionId, listener) => {
      dataListeners.add(listener);
      return () => dataListeners.delete(listener);
    },
    isAlive: () => true,
    close: () => true,
    list: () => [],
    runOneshot: async () => ({ exitCode: 0, output: "", sessionId: "s-boot" }),
  };

  setTimeout(() => {
    backlog = `Windows PowerShell\nCopyright\n\n${prompt}`;
    for (const listener of dataListeners) listener(backlog);
  }, 60);

  setPtyShellPort(port);

  const result = await getAgentShellSession("chat-boot").exec({
    command: "echo hi",
    timeoutMs: 5000,
    cappedNote: "",
  });

  const cmdWrites = writes.filter((w) => w.includes("\x1b[200~"));
  assert.equal(cmdWrites.length, 1);
  assert.ok(cmdWrites[0]!.includes("echo hi"));
  assert.equal(result.ok, true);

  setPtyShellPort(null);
});
