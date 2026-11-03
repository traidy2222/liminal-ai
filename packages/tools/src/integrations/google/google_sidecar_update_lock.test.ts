import assert from "node:assert/strict";
import test, { mock } from "node:test";
import childProcess, { type SpawnOptions } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { ensureGoogleSidecarRunning, stopGoogleSidecar } from "./google_sidecar.js";

test("a live Google helper does not lock the desktop installation during an update", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liminal-google-update-"));
  const installation = path.join(root, "installed app");
  const appWorkspace = path.join(installation, "liminald", "repo");
  const userData = path.join(root, "user-data");
  const observedCwd = path.join(root, "worker-cwd.txt");
  const fixture = path.join(root, "worker.cjs");
  const previousCwd = process.cwd();
  const overrides = {
    AGENT_GLOBAL_STORAGE_ROOT: userData,
    AGENT_GOOGLE_SIDECAR_ENABLE: "1",
    AGENT_GOOGLE_SIDECAR_PORT: "",
    GOOGLE_OAUTH_CLIENT_ID: "fixture.apps.googleusercontent.com",
  };
  const previousEnv = Object.fromEntries(Object.keys(overrides).map(key => [key, process.env[key]]));
  const listener = net.createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  overrides.AGENT_GOOGLE_SIDECAR_PORT = String((listener.address() as net.AddressInfo).port);
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  fs.mkdirSync(appWorkspace, { recursive: true });
  fs.writeFileSync(fixture, `require('node:fs').writeFileSync(${JSON.stringify(observedCwd)}, process.cwd());
require('node:http').createServer((req,res)=>{req.resume();res.end('{}');}).listen(Number(process.env.WORKSPACE_MCP_PORT),'127.0.0.1');`);
  const originalSpawn = childProcess.spawn;
  let worker: childProcess.ChildProcess | undefined;
  // Use a real child instead of requiring uv or Google access in CI. Preserve
  // the production launch options, including the working directory under test.
  mock.method(childProcess, "spawn", ((_bin: string, _args: string[], options: SpawnOptions) => {
    worker = originalSpawn(process.execPath, [fixture], { ...options, shell: false });
    return worker;
  }) as typeof childProcess.spawn);
  syncBuiltinESMExports();
  Object.assign(process.env, overrides);
  try {
    process.chdir(appWorkspace);
    const result = await ensureGoogleSidecarRunning("fixture-token", { tools: ["docs"] });
    assert.equal(result.ok, true, result.error);
    assert.ok(worker && worker.exitCode === null);
    // Release the test parent's cwd before moving the install. On Windows the
    // old helper still holds it open and rename fails with the user's EPERM.
    process.chdir(root);
    fs.renameSync(installation, installation + ".old");
    assert.equal(fs.readFileSync(observedCwd, "utf8"), path.join(userData, "sidecars", "google_workspace"));
    assert.equal(worker.exitCode, null, "the helper stays live during the swap");
  } finally {
    process.chdir(previousCwd);
    const exited = worker && worker.exitCode === null ? new Promise<void>(resolve => worker!.once("exit", () => resolve())) : Promise.resolve();
    await stopGoogleSidecar(true);
    await exited;
    mock.restoreAll();
    syncBuiltinESMExports();
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
