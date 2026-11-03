import test from "node:test";
import assert from "node:assert/strict";
import { guardToolArgs } from "./tool_arg_guard.js";

test("guard blocks rm -rf / in run_shell", () => {
  assert.equal(
    guardToolArgs("run_shell", { command: "rm -rf /" }) !== null,
    true
  );
});

test("guard allows benign echo", () => {
  assert.equal(guardToolArgs("run_shell", { command: "echo hello" }), null);
});

test("guard blocks loopback web_fetch", () => {
  assert.match(guardToolArgs("web_fetch", { url: "http://127.0.0.1:8080/" }) ?? "", /loopback/);
});

test("guard allows https example.com", () => {
  assert.equal(guardToolArgs("web_fetch", { url: "https://example.com/" }), null);
});

test("execute_code allows valid python snippet", () => {
  assert.equal(
    guardToolArgs("execute_code", {
      language: "python",
      code: "print(2 + 2)",
      timeout_ms: 5_000,
      cwd: ".",
    }),
    null
  );
});

test("execute_code permits ordinary binary reads and os metadata imports", () => {
  for (const code of [
    "import os, struct\np = r'C:\\games\\Ghost Rider.iso'\nprint(os.path.exists(p), os.path.getsize(p))\nwith open(p, 'rb') as f:\n    print(struct.unpack('<I', f.read(4)))",
    "from os import path, stat\nprint(path.exists('game.iso'), stat('game.iso').st_size)",
    "from os import (path,\n stat)\nprint(path.basename('game.iso'))",
    "import os as operating\nprint(operating.path.getsize('game.iso'))",
    "from os.path import exists, getsize\nprint(exists('game.iso'))",
  ]) {
    assert.equal(guardToolArgs("execute_code", { language: "python", code }), null, code);
  }
  assert.equal(guardToolArgs("execute_code", {
    language: "javascript",
    code: "const fs = require('node:fs'); console.log(fs.statSync('game.iso').size); /iso/.exec('game.iso');",
  }), null);
});

test("execute_code still guards explicit process primitives and dynamic imports", () => {
  for (const code of [
    "import os\nos.system('whoami')",
    "os . popen ('whoami')",
    "import os\nos.execl('/bin/sh', 'sh')",
    "import os\nos.execvp('sh', ['sh'])",
    "import os\nos.spawnve(0, '/bin/sh', ['sh'], {})",
    "import os as operating\noperating.system('whoami')",
    "import struct, os as operating\noperating.popen('whoami')",
    "from os import system as launch\nlaunch('whoami')",
    "from os import path, spawnlp",
    "from os import (\n path, system\n)",
    "from os import *",
    "import subprocess\nsubprocess.run(['whoami'])",
    "from subprocess import run\nrun(['whoami'])",
    "__import__('os').system('whoami')",
  ]) {
    assert.match(guardToolArgs("execute_code", { language: "python", code }) ?? "", /dangerous/i, code);
  }
  for (const code of ["require('child_process').exec('whoami')", "process.binding('spawn_sync')", "Deno.run({cmd:['whoami']})"]) {
    assert.match(guardToolArgs("execute_code", { language: "javascript", code }) ?? "", /dangerous/i, code);
  }
});

test("execute_code blocks dangerous process escape pattern", () => {
  assert.match(
    guardToolArgs("execute_code", {
      language: "javascript",
      code: "require('child_process').exec('whoami')",
    }) ?? "",
    /dangerous/i
  );
});

test("execute_code blocks invalid timeout and cwd escape", () => {
  assert.match(
    guardToolArgs("execute_code", {
      language: "python",
      code: "print('x')",
      timeout_ms: 999_999,
      cwd: "../..",
    }) ?? "",
    /timeout_ms/i
  );
  assert.match(
    guardToolArgs("execute_code", {
      language: "python",
      code: "print('x')",
      timeout_ms: 20_000,
      cwd: "../..",
    }) ?? "",
    /workspace-relative/i
  );
});

test("execute_code supports its documented Python default without guessing another language", () => {
  assert.equal(guardToolArgs("execute_code", {code: "print('fixture')"}), null);
  assert.match(guardToolArgs("execute_code", {language: "", code: "print('fixture')"}) ?? "", /language/);
  assert.match(guardToolArgs("execute_code", {code: "import os; os.system('whoami')"}) ?? "", /dangerous/);
});

test("markets_quote validates symbols and asset_type", () => {
  assert.equal(
    guardToolArgs("markets_quote", {
      symbols: ["AAPL", "EURUSD", "gold", "BTC-USD"],
      asset_type: "auto",
    }),
    null
  );
  assert.match(
    guardToolArgs("markets_quote", {
      symbols: ["AAPL", "bad symbol !"],
      asset_type: "equity_etf",
    }) ?? "",
    /unsupported characters/i
  );
  assert.match(
    guardToolArgs("markets_quote", {
      symbols: Array.from({ length: 20 }, () => "AAPL"),
      asset_type: "equity_etf",
    }) ?? "",
    /max batch size/i
  );
});
