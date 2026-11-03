import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { PtyManagerPort } from "./pty_shell_port.js";
import { setPtyShellPort } from "./pty_shell_port.js";
import {
  buildHumanShellInput,
  getAgentShellSession,
  resetAgentShellSessionsForTests,
} from "./agent_shell_session.js";

beforeEach(() => {
  resetAgentShellSessionsForTests();
  setPtyShellPort(null);
});

const A = "\x1b]133;A\x07";
const B = "\x1b]133;B\x07";
const D = (code: number) => `\x1b]133;D;${code}\x07`;

/** Mock PTY whose shell emits OSC 133 markers like the injected integration. */
function createMarkerPort(opts: { exitCode: number; output: string }) {
  const listeners = new Set<(chunk: string) => void>();
  let backlog = "";
  const emit = (chunk: string) => {
    backlog += chunk;
    for (const l of [...listeners]) l(chunk);
  };
  const writes: string[] = [];
  const port: PtyManagerPort = {
    ensure: async () => {
      // Shell boots and paints an integrated prompt.
      setTimeout(() => emit(`${D(0)}${A}PS C:\\repo> ${B}`), 5);
      return { sessionId: "s1", label: "Agent shell", cwd: "C:\\repo" };
    },
    write: (_id, data) => {
      writes.push(data);
      const typed = data.replace(/\x1b\[200~|\x1b\[201~|\r?\n/g, "");
      setTimeout(() => emit(`${typed}\r\n${opts.output}\r\n${D(opts.exitCode)}${A}PS C:\\repo> ${B}`), 5);
      return true;
    },
    readTail: (_id, chars) => backlog.slice(-chars),
    onData: (_id, listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isAlive: () => true,
    close: () => true,
    list: () => [],
    runOneshot: async () => ({ exitCode: 0, output: "", sessionId: "s1" }),
  };
  return { port, writes, emit };
}

test("marker mode: exec returns output + exit code from D marker, no probe typed", async () => {
  const { port, writes } = createMarkerPort({ exitCode: 0, output: "clean tree" });
  setPtyShellPort(port);
  const result = await getAgentShellSession("chat-m1").exec({
    command: "git status",
    timeoutMs: 5000,
  });
  assert.equal(result.ok, true);
  assert.match(result.output ?? "", /clean tree/);
  assert.ok(!(result.output ?? "").includes("git status"), "echo stripped");
  // exactly one stdin write: the command itself — no exit-code probe
  assert.equal(writes.length, 1);
  assert.ok(writes[0]!.includes("git status"));
  setPtyShellPort(null);
});

test("marker mode: non-zero exit code surfaces from the D marker", async () => {
  const { port, writes } = createMarkerPort({ exitCode: 2, output: "boom" });
  setPtyShellPort(port);
  const result = await getAgentShellSession("chat-m2").exec({
    command: "npm test",
    timeoutMs: 5000,
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /Exit code 2/);
  assert.equal(writes.length, 1);
  setPtyShellPort(null);
});

test("cancelling an interactive foreground command closes only its session", async () => {
  const { port } = createMarkerPort({ exitCode: 0, output: "unused" });
  const closed: string[] = [];
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  port.write = () => { started(); return true; }; // Hold the command without a completion marker.
  port.close = (id) => { closed.push(id); return true; };
  port.isAlive = (id) => !closed.includes(id);
  setPtyShellPort(port);
  const controller = new AbortController();
  const pending = getAgentShellSession("chat-cancel").exec({ command: "owned-long-command", timeoutMs: 5000, signal: controller.signal });
  await ready;
  controller.abort();
  const result = await pending;
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /cancel/i);
  assert.deepEqual(closed, ["s1"]);
  assert.equal(port.isAlive("dedicated-background"), true);
  setPtyShellPort(null);
});

test("a cancelled queued interactive command is never written to the terminal", async () => {
  const { port, writes, emit } = createMarkerPort({ exitCode: 0, output: "unused" });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => { started = resolve; });
  port.write = (_id, data) => { writes.push(data); started(); return true; };
  setPtyShellPort(port);
  const session = getAgentShellSession("chat-queued-cancel");
  const first = session.exec({ command: "first-command", timeoutMs: 5000 });
  await ready;
  const controller = new AbortController();
  const queued = session.exec({ command: "must-never-run", timeoutMs: 5000, signal: controller.signal });
  controller.abort();
  const result = await queued;
  assert.equal(result.ok, false);
  assert.equal(writes.length, 1);
  emit(`first completed\r\n${D(0)}${A}PS C:\\repo> ${B}`);
  assert.equal((await first).ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes.length, 1);
  setPtyShellPort(null);
});

test("long diagnostic output does not turn a failed interactive command into success", async () => {
  const { port } = createMarkerPort({ exitCode: 7, output: "diagnostic-".repeat(30) });
  setPtyShellPort(port);
  try {
    const result = await getAgentShellSession("chat-long-error").exec({ command: "failing-command", timeoutMs: 5000 });
    assert.equal(result.ok, false);
    if (!result.ok) { assert.match(result.error, /Exit code 7/); assert.match(result.error, /diagnostic-/); }
  } finally { setPtyShellPort(null); }
});

test("buildHumanShellInput uses bracketed paste and newline", () => {
  const input = buildHumanShellInput("echo hi");
  assert.ok(input.startsWith("\x1b[200~"));
  assert.ok(input.includes("echo hi"));
  assert.ok(input.includes("\x1b[201~"));
  assert.ok(input.endsWith("\r\n") || input.endsWith("\n"));
  assert.ok(!input.includes("$LASTEXITCODE"));
  assert.ok(!input.includes("__LIMINAL"));
});
