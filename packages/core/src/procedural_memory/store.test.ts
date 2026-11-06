import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ProcedureStore } from "./store.js";
import { identifyProcedureWorkspace } from "./workspace.js";
const source = pathToFileURL(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "store.ts"),
).href;
async function root(t: any) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "liminal-procedure-store-"),
  );
  t.after(async () => {
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    await fs.rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 30,
    });
  });
  return dir;
}
function child(script: string, args: string[]) {
  return spawn(
    process.execPath,
    [
      "--import",
      "tsx",
      "--input-type=module",
      "-e",
      `import {ProcedureStore} from ${JSON.stringify(source)};${script}`,
      ...args,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
}
function finished(p: ReturnType<typeof child>) {
  return new Promise<{ code: number | null; out: string; err: string }>(
    (resolve, reject) => {
      let out = "",
        err = "";
      p.stdout.on("data", (b) => (out += b));
      p.stderr.on("data", (b) => (err += b));
      p.once("error", reject);
      p.once("exit", (code) => resolve({ code, out, err }));
    },
  );
}
test("four fresh processes concurrently initialize and append without lost evidence", async (t) => {
  const dir = await root(t),
    file = path.join(dir, "store.sqlite");
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, i) =>
      finished(
        child(
          `const db=new ProcedureStore(process.argv[1]);for(let n=0;n<50;n++){const id=process.argv[2]+'-'+n;db.beginEpisode({runId:id,workspaceId:'w',chatId:'c',taskRevision:1,goal:'fixture',model:'offline',harness:'test',environment:{}});db.recordEvent({eventId:id,runId:id,kind:'tool_result',callId:id,ok:true,data:{n,padding:'x'.repeat(20000)}});}db.close();`,
          [file, String(i)],
        ),
      ),
    ),
  );
  for (const r of results) assert.equal(r.code, 0, r.err);
  const db = new ProcedureStore(file);
  try {
    assert.equal(
      (db.db.prepare("SELECT count(*) n FROM events").get() as any).n,
      200,
    );
    assert.equal(db.db.pragma("quick_check", { simple: true }), "ok");
  } finally {
    db.close();
  }
});

test("WAL initialization waits for a transient rollback-mode writer", async (t) => {
  const directory = await root(t),
    file = path.join(directory, "contended.sqlite");
  const writer = child(
    `const {default:Database}=await import('better-sqlite3');const raw=new Database(process.argv[1]);raw.exec("CREATE TABLE marker(value TEXT); BEGIN IMMEDIATE; INSERT INTO marker VALUES('kept')");console.log('READY');setTimeout(()=>{raw.exec('COMMIT');raw.close()},400);`,
    [file],
  );
  const done = finished(writer);
  let store: ProcedureStore | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Writer did not become ready")),
        5000,
      );
      writer.stdout.on("data", (data) => {
        if (String(data).includes("READY")) {
          clearTimeout(timeout);
          resolve();
        }
      });
      writer.once("exit", (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error("Writer exited before readiness"));
      });
    });
    store = new ProcedureStore(file);
    assert.equal(store.db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(
      (store.db.prepare("SELECT value FROM marker").get() as { value: string })
        .value,
      "kept",
    );
    assert.equal((await done).code, 0);
  } finally {
    store?.close();
    if (writer.exitCode === null) writer.kill();
    await done;
  }
});
test("killed uncommitted transaction rolls back; SQLite backup reopens consistently", async (t) => {
  const dir = await root(t),
    file = path.join(dir, "store.sqlite");
  const initial = new ProcedureStore(file);
  initial.registerWorkspace("original", {});
  initial.close();
  const p = child(
    `const db=new ProcedureStore(process.argv[1]);db.db.exec('BEGIN IMMEDIATE');db.registerWorkspace('uncommitted',{});console.log('READY');setInterval(()=>{},1000);`,
    [file],
  );
  const done = finished(p);
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Worker readiness timed out")),
      10000,
    );
    p.stdout.on("data", (b) => {
      if (String(b).includes("READY")) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  p.kill();
  await done;
  const recovered = new ProcedureStore(file);
  try {
    assert.equal(
      (recovered.db.prepare("SELECT count(*) n FROM workspaces").get() as any)
        .n,
      1,
    );
    const backup = path.join(dir, "backup.sqlite");
    await recovered.backup(backup);
    const restored = new ProcedureStore(backup);
    try {
      assert.equal(restored.db.pragma("quick_check", { simple: true }), "ok");
      assert.equal(
        (restored.db.prepare("SELECT id FROM workspaces").get() as any).id,
        "original",
      );
    } finally {
      restored.close();
    }
  } finally {
    recovered.close();
  }
});
test("newer schema is refused without downgrade", async (t) => {
  const dir = await root(t),
    file = path.join(dir, "new.sqlite"),
    db = new ProcedureStore(file);
  db.db.pragma("user_version = 99");
  db.close();
  await assert.rejects(async () => new ProcedureStore(file), /newer schema/);
});
test("identity supports no remote, uncommitted edits, new commits, branches, linked worktrees and detached HEAD", async (t) => {
  const dir = await root(t),
    repo = path.join(dir, "repo");
  await fs.mkdir(repo);
  const git = (args: string[]) => {
    const r = spawnSync("git", ["-C", repo, ...args], {
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git(["init", "-b", "main"]);
  await fs.writeFile(path.join(repo, "README.md"), "one");
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "one",
  ]);
  const a = await identifyProcedureWorkspace(repo);
  assert.equal(git(["remote"]), "");
  await fs.writeFile(path.join(repo, "README.md"), "two");
  assert.equal((await identifyProcedureWorkspace(repo)).id, a.id);
  git(["add", "."]);
  git([
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-m",
    "two",
  ]);
  assert.equal((await identifyProcedureWorkspace(repo)).id, a.id);
  const linked = path.join(dir, "linked");
  git(["worktree", "add", "-b", "feature", linked]);
  assert.notEqual((await identifyProcedureWorkspace(linked)).id, a.id);
  git(["checkout", "-b", "different"]);
  assert.notEqual((await identifyProcedureWorkspace(repo)).id, a.id);
  git(["checkout", "--detach"]);
  const detached = await identifyProcedureWorkspace(repo);
  assert.equal(detached.branch, null);
  assert.notEqual(detached.id, a.id);
});

test("schema one upgrades transactionally without discarding existing rows", async (t) => {
  const dir = await root(t),
    file = path.join(dir, "upgrade.sqlite"),
    old = new ProcedureStore(file);
  old.registerWorkspace("retained", {});
  old.db.exec("DROP TABLE consolidation_claims; PRAGMA user_version = 1;");
  old.close();
  const upgraded = new ProcedureStore(file);
  try {
    assert.equal(upgraded.db.pragma("user_version", { simple: true }), 2);
    assert.equal(
      (upgraded.db.prepare("SELECT id FROM workspaces").get() as any).id,
      "retained",
    );
    assert(upgraded.claimConsolidation("episode", "owner"));
  } finally {
    upgraded.close();
  }
});
