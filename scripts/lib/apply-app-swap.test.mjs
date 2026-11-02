import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyAppFolderSwap } from "./apply-app-swap.mjs";
function fixture(t, platform = "windows") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "liminal-update-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(
      root,
      platform === "macos" ? "My Liminal.app" : "installed app",
    ),
    release = path.join(root, "release");
  const source =
    platform === "macos" ? path.join(release, "liminal_desktop.app") : release;
  const relative = platform === "macos" ? path.join("Contents", "MacOS") : "";
  const exe =
    platform === "windows" ? "liminal_desktop.exe" : "liminal_desktop";
  for (const [dir, version] of [
    [target, "old"],
    [source, "new"],
  ]) {
    const runtime = path.join(dir, relative);
    fs.mkdirSync(path.join(runtime, "liminald", "repo"), { recursive: true });
    fs.writeFileSync(path.join(runtime, exe), version);
    fs.writeFileSync(
      path.join(runtime, "liminald", "bundle.json"),
      JSON.stringify({ liminalVersion: version }),
    );
    fs.writeFileSync(
      path.join(runtime, "liminald", "repo", ".env"),
      version + "-config",
    );
  }
  return {
    root,
    target,
    source,
    release,
    relative,
    exe,
    exeDir: path.join(target, relative),
  };
}
for (const platform of ["windows", "linux", "macos"])
  test(`${platform} app update preserves local configuration and keeps a recoverable backup`, async (t) => {
    const f = fixture(t, platform);
    let launched = false;
    const result = await applyAppFolderSwap({
      exeDir: f.exeDir,
      extractedRoot: f.release,
      platform,
      launch: async ({ target, exePath }) => {
        launched = true;
        assert.equal(target, f.target);
        assert.equal(fs.readFileSync(exePath, "utf8"), "new");
        assert.equal(
          fs.readFileSync(
            path.join(target, f.relative, "liminald/repo/.env"),
            "utf8",
          ),
          "old-config",
        );
      },
    });
    assert.equal(launched, true);
    assert.equal(
      fs.readFileSync(path.join(result.backup, f.relative, f.exe), "utf8"),
      "old",
    );
    assert.equal(
      fs.readFileSync(
        path.join(f.source, f.relative, "liminald/repo/.env"),
        "utf8",
      ),
      "new-config",
    );
  });
test("failure to launch rolls back and reopens the original installation", async (t) => {
  const f = fixture(t);
  let launches = 0;
  await assert.rejects(
    applyAppFolderSwap({
      exeDir: f.exeDir,
      extractedRoot: f.release,
      platform: "windows",
      launch: async ({ exePath }) => {
        launches++;
        if (launches === 1) throw Error("simulated launch failure");
        assert.equal(fs.readFileSync(exePath, "utf8"), "old");
      },
    }),
    /simulated launch failure/,
  );
  assert.equal(launches, 2);
  assert.equal(
    fs.readFileSync(path.join(f.target, "liminald/repo/.env"), "utf8"),
    "old-config",
  );
  assert.equal(
    fs.readdirSync(f.root).some((n) => n.includes(".new.")),
    false,
  );
});
test("incomplete archive leaves the installed application untouched", async (t) => {
  const f = fixture(t);
  fs.rmSync(path.join(f.source, "liminald/bundle.json"));
  await assert.rejects(
    applyAppFolderSwap({
      exeDir: f.exeDir,
      extractedRoot: f.release,
      platform: "windows",
      launch: async () => assert.fail("must not launch"),
    }),
    /Incomplete/,
  );
  assert.equal(fs.readFileSync(path.join(f.target, f.exe), "utf8"), "old");
});
