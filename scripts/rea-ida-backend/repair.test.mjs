import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyRepair, planRepair, publicPlan, sha256, transformPython, transformConnection, orderRepairWrites } from "../repair-rea-ida-backend.mjs";

async function fixture(action) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "liminal-rea-repair-"));
  const paths = { reaRoot: path.join(root, "rea"), idaSitePackages: path.join(root, "site-packages") };
  const source = path.join(paths.reaRoot, "dist/ida/fixture.js");
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.mkdir(path.join(paths.idaSitePackages, "ida_pro_mcp/ida_mcp"), { recursive: true });
  await fs.mkdir(path.join(paths.idaSitePackages, "ida_pro_mcp-2.0.0.dist-info"));
  await fs.writeFile(path.join(paths.reaRoot, "package.json"), JSON.stringify({ name: "rea-agents", version: "6.4.0" }));
  await fs.writeFile(path.join(paths.idaSitePackages, "ida_pro_mcp-2.0.0.dist-info/METADATA"), "Name: ida-pro-mcp\nVersion: 2.0.0\n");
  const original = Buffer.from("original source\n"), repaired = Buffer.from("repaired source\n");
  await fs.writeFile(source, original);
  const manifest = [{ root: "reaRoot", relative: "dist/ida/fixture.js", original: sha256(original), patched: sha256(repaired), transform: text => text.replace("original", "repaired") }];
  try { await action({ root, paths, source, manifest, original, repaired }); }
  finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); assert(path.basename(root).startsWith("liminal-rea-repair-"));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 });
  }
}

test("dry-run makes no writes; explicit apply preserves originals, verifies helpers, and is idempotent", async () => fixture(async ({ paths, source, manifest, original, repaired }) => {
  const plan = await planRepair(paths, manifest);
  assert.equal(publicPlan(plan).files.length, 5);
  assert((await fs.readFile(source)).equals(original));
  await assert.rejects(fs.access(source + ".liminal-rea-ida-v1.bak"));
  assert.equal(await applyRepair(plan), 5);
  assert((await fs.readFile(source)).equals(repaired));
  assert((await fs.readFile(source + ".liminal-rea-ida-v1.bak")).equals(original));
  const second = await planRepair(paths, manifest);
  assert(second.files.every(file => !file.changed)); assert.equal(await applyRepair(second), 0);
}));

test("unexpected versions, source fingerprints and pre-existing helpers fail closed", async () => fixture(async ({ paths, source, manifest }) => {
  const pkg = path.join(paths.reaRoot, "package.json");
  await fs.writeFile(pkg, JSON.stringify({ name: "rea-agents", version: "6.8.0" }));
  await assert.rejects(planRepair(paths, manifest), /6\.4\.0 only/);
  await fs.writeFile(pkg, JSON.stringify({ name: "rea-agents", version: "6.4.0" }));
  const original = await fs.readFile(source);
  await fs.appendFile(source, "foreign changes");
  await assert.rejects(planRepair(paths, manifest), /Unsupported backend fingerprint/);
  await fs.writeFile(source, original);
  await fs.writeFile(path.join(paths.reaRoot, "dist/ida/liminal-health-readiness.mjs"), "foreign helper");
  await assert.rejects(planRepair(paths, manifest), /Unexpected existing compatibility helper/);
}));

test("conflicting backup and modified-after-plan sources are never overwritten", async () => fixture(async ({ paths, source, manifest }) => {
  const backup = source + ".liminal-rea-ida-v1.bak";
  await fs.writeFile(backup, "foreign backup");
  await assert.rejects(planRepair(paths, manifest), /Conflicting repair backup/);
  await fs.unlink(backup);
  const plan = await planRepair(paths, manifest);
  await fs.appendFile(source, "concurrent edit");
  await assert.rejects(applyRepair(plan), /changed since plan/);
  assert.match(await fs.readFile(source, "utf8"), /concurrent edit/);
  await assert.rejects(fs.access(backup));
}));

test("known prior repair upgrades from the immutable original backup and is idempotent", async () => fixture(async ({ paths, source, manifest, original, repaired }) => {
  const prior = Buffer.from("known prior repair\n");
  await fs.writeFile(source, prior);
  const backup = source + ".liminal-rea-ida-v1.bak";
  manifest[0].previous = [sha256(prior)];
  await assert.rejects(planRepair(paths, manifest), /lacks its verified original backup/);
  await fs.writeFile(backup, original);
  const plan = await planRepair(paths, manifest);
  assert(plan.files[0].before.equals(prior)); assert(plan.files[0].after.equals(repaired));
  await applyRepair(plan);
  assert((await fs.readFile(backup)).equals(original)); assert((await fs.readFile(source)).equals(repaired));
  assert.equal(await applyRepair(await planRepair(paths, manifest)), 0);
}));

test("failed upgrade restores the prior repaired source, never the original backup", async () => fixture(async ({ paths, source, manifest, original }) => {
  const prior = Buffer.from("known prior repair\n");
  await fs.writeFile(source, prior); await fs.writeFile(source + ".liminal-rea-ida-v1.bak", original);
  manifest[0].previous = [sha256(prior)];
  const plan = await planRepair(paths, manifest);
  const second = path.join(path.dirname(source), "later-failure.js"); await fs.writeFile(second, original);
  plan.files.push({ file: second, before: original, after: null, backup: second + ".bak", changed: true });
  await assert.rejects(applyRepair(plan));
  assert((await fs.readFile(source)).equals(prior)); assert((await fs.readFile(source + ".liminal-rea-ida-v1.bak")).equals(original));
}));

test("failed apply rolls back written sources and retains verified backups", async () => fixture(async ({ paths, source, manifest, original }) => {
  const plan = await planRepair(paths, manifest);
  const second = path.join(path.dirname(source), "later-failure.js");
  await fs.writeFile(second, original);
  plan.files.push({ file: second, before: original, after: null, backup: second + ".bak", changed: true });
  await assert.rejects(applyRepair(plan), /data.*argument|must be of type/i);
  assert((await fs.readFile(source)).equals(original));
  assert((await fs.readFile(source + ".liminal-rea-ida-v1.bak")).equals(original));
  for (const file of plan.files.filter(file => file.before === null)) await assert.rejects(fs.access(file.file));
}));

test("helpers are installed before source imports, and the session follows compatible connection options", () => {
  const source = name => ({ file: name, changed: true, backup: name + ".bak" });
  const helper = { file: "helper.mjs", changed: true };
  const ordered = orderRepairWrites([source("IdaProvider.js"), source("IdaSessionClient.js"), source("IdaMcpConnection.js"), helper]);
  assert.deepEqual(ordered.map(file => file.file), ["helper.mjs", "IdaMcpConnection.js", "IdaSessionClient.js", "IdaProvider.js"]);
});

test("repair anchors reject unsupported layouts and preserve native call arguments", () => {
  assert.throws(() => transformPython("def _server_health_full(): pass"), /Unsupported backend source layout/);
  const py = "from .mainthread import get_pump\r\n@idasync\r\ndef _server_health_full() -> ServerHealthResult:\r\n    return _build_health_payload()\r\n";
  const patched = transformPython(py);
  assert.match(patched, /get_pump\(\), ida_auto, idaapi.BADADDR, get_tool_deadline\(\)/);
  assert.equal(patched.replaceAll("\r\n", "").includes("\n"), false, "preserve original CRLF layout");
  const connection = 'async call(name, args) { return client.callTool({ name, arguments: args }, { timeout: config.timeoutMs }); }';
  const actual = transformConnection(connection);
  assert.match(actual, /arguments: args/); assert.match(actual, /signal: options\?\.signal/);
  assert.throws(() => transformConnection(connection + connection), /Unsupported backend source layout/);
});
