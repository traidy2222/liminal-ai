import assert from "node:assert/strict";
import { test } from "node:test";
import { Osc133Tracker, stripEchoedCommand, stripOsc133 } from "./shell_integration.js";

const A = "\x1b]133;A\x07";
const B = "\x1b]133;B\x07";
const D = (code: number) => `\x1b]133;D;${code}\x07`;

test("tracker parses prompt cycle and exit code", () => {
  const t = new Osc133Tracker();
  const events = t.feed(`${D(0)}${A}PS C:\\repo> ${B}`);
  assert.deepEqual(
    events.map((e) => e.kind),
    ["D", "A", "B"]
  );
  assert.equal(events[0]!.exitCode, 0);
  assert.equal(t.atPrompt, true);
  assert.equal(t.integrationActive, true);
});

test("tracker handles markers split across chunks", () => {
  const t = new Osc133Tracker();
  const full = `out\n${D(17)}${A}PS> ${B}`;
  let events: ReturnType<Osc133Tracker["feed"]> = [];
  // feed one char at a time — worst-case splitting
  for (const ch of full) events = events.concat(t.feed(ch));
  assert.deepEqual(
    events.map((e) => e.kind),
    ["D", "A", "B"]
  );
  assert.equal(events[0]!.exitCode, 17);
  assert.equal(t.atPrompt, true);
});

test("tracker records offsets in the total stream", () => {
  const t = new Osc133Tracker();
  t.feed("hello");
  const [d] = t.feed(D(0));
  assert.equal(d!.offset, 5);
});

test("tracker supports ST terminator and missing exit code", () => {
  const t = new Osc133Tracker();
  const [d] = t.feed("\x1b]133;D\x1b\\");
  assert.equal(d!.kind, "D");
  assert.equal(d!.exitCode, null);
});

test("atPrompt false while command running", () => {
  const t = new Osc133Tracker();
  t.feed(`${A}PS> ${B}`);
  assert.equal(t.atPrompt, true);
  t.feed("npm test\r\nrunning…\n");
  assert.equal(t.atPrompt, true); // no marker since B — still last marker
  t.feed(D(0));
  assert.equal(t.atPrompt, false);
  assert.equal(t.lastDone?.exitCode, 0);
});

test("stripOsc133 removes markers, keeps text", () => {
  assert.equal(stripOsc133(`${D(0)}${A}PS> ${B}ok`), "PS> ok");
});

test("stripEchoedCommand drops single echoed line", () => {
  const out = stripEchoedCommand("git status\nclean tree", "git status");
  assert.equal(out, "clean tree");
});

test("stripEchoedCommand drops multi-line echo with continuation prompts", () => {
  const cmd = 'echo "a\nb"';
  const slice = 'echo "a\n>> b"\na\nb';
  assert.equal(stripEchoedCommand(slice, cmd), "a\nb");
});

test("stripEchoedCommand always drops at least the first line", () => {
  const out = stripEchoedCommand("mangled echo line\nreal output", "totally different");
  assert.equal(out, "real output");
});
