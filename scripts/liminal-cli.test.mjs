import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnvFile, writeEnvMerge, firstApiKey } from "./lib/envWriter.mjs";
import { resolveRepoRoot, getDefaultInstallDir } from "./lib/paths.mjs";
import { resolveAutoUpdatePolicy } from "./lib/update.mjs";

const REPO_ROOT = resolveRepoRoot(path.dirname(fileURLToPath(import.meta.url)));

function testParseEnvFile() {
  const parsed = parseEnvFile(`
# comment
AGENT_API_KEY=secret
PORT=3002
QUOTED="hello world"
`);
  assert.equal(parsed.AGENT_API_KEY, "secret");
  assert.equal(parsed.PORT, "3002");
  assert.equal(parsed.QUOTED, "hello world");
}

function testWriteEnvMergePreservesComments() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "liminal-env-"));
  const envPath = path.join(dir, ".env");
  fs.writeFileSync(
    envPath,
    "# header\nAGENT_API_KEY=old\n# tail\nOTHER=keep\n",
    "utf8",
  );
  writeEnvMerge({
    envPath,
    updates: { AGENT_API_KEY: "new-key", PORT: "3001" },
  });
  const content = fs.readFileSync(envPath, "utf8");
  assert.match(content, /AGENT_API_KEY=new-key/);
  assert.match(content, /OTHER=keep/);
  assert.match(content, /PORT=3001/);
  assert.match(content, /# header/);
  fs.rmSync(dir, { recursive: true, force: true });
}

function testFirstApiKey() {
  assert.equal(firstApiKey({ OPENROUTER_API_KEY: "x" }), "x");
  assert.equal(firstApiKey({ AGENT_API_KEY: "a", OPENAI_API_KEY: "b" }), "a");
  assert.equal(firstApiKey({}), null);
}

function testResolveRepoRoot() {
  const root = resolveRepoRoot(REPO_ROOT);
  assert.equal(root, REPO_ROOT);
  assert.ok(fs.existsSync(path.join(root, "packages", "core")));
}

function testDefaultInstallDir() {
  const dir = getDefaultInstallDir();
  assert.ok(dir.includes("liminal"));
}

function testResolveAutoUpdatePolicy() {
  const prevSkip = process.env.LIMINAL_SKIP_UPDATE;
  const prevAuto = process.env.LIMINAL_AUTO_UPDATE;
  delete process.env.LIMINAL_SKIP_UPDATE;
  delete process.env.LIMINAL_AUTO_UPDATE;
  try {
    assert.ok(resolveAutoUpdatePolicy([]));
    assert.equal(resolveAutoUpdatePolicy(["--no-update"]), null);
    assert.equal(resolveAutoUpdatePolicy(["--no-pull"])?.pull, false);
    assert.equal(resolveAutoUpdatePolicy([])?.pull, true);
    process.env.LIMINAL_SKIP_UPDATE = "1";
    assert.equal(resolveAutoUpdatePolicy([]), null);
  } finally {
    if (prevSkip === undefined) delete process.env.LIMINAL_SKIP_UPDATE;
    else process.env.LIMINAL_SKIP_UPDATE = prevSkip;
    if (prevAuto === undefined) delete process.env.LIMINAL_AUTO_UPDATE;
    else process.env.LIMINAL_AUTO_UPDATE = prevAuto;
  }
}

testParseEnvFile();
testWriteEnvMergePreservesComments();
testFirstApiKey();
testResolveRepoRoot();
testDefaultInstallDir();
testResolveAutoUpdatePolicy();

console.log("liminal-cli: all tests passed");
